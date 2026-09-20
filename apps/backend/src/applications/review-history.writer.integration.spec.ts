import {
  ApplicationReviewEventKind,
  MemberKind,
  ProgramCategory,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationsRepository } from './applications.repository';
import { appendReviewHistory } from './review-history.writer';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;

const PREFIX = 'test:review-history-writer:';
const ACTOR_ID = `${PREFIX}actor`;
const PROGRAM_ID = `${PREFIX}program`;
const TEAM_A_ID = `${PREFIX}team-a`;
const TEAM_B_ID = `${PREFIX}team-b`;
const APPLICANT_A_ID = `${PREFIX}applicant-a`;
const APPLICANT_B_ID = `${PREFIX}applicant-b`;
const APPLICATION_A_ID = `${PREFIX}application-a`;
const APPLICATION_B_ID = `${PREFIX}application-b`;

const prisma = new PrismaService();
const repository = new ApplicationsRepository(prisma, {
  TEAM_JOIN_CODE_SECRET: 'synthetic-review-history-writer-secret',
});

async function cleanup(): Promise<void> {
  await prisma.applicationReviewHistory.deleteMany({
    where: { applicationId: { startsWith: PREFIX } },
  });
  await prisma.application.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  await prisma.teamMember.deleteMany({
    where: { teamId: { startsWith: PREFIX } },
  });
  await prisma.team.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.program.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

async function seed(): Promise<void> {
  await prisma.user.createMany({
    data: [
      {
        id: ACTOR_ID,
        githubId: 9_320_000_001n,
        nickname: 'review-history-actor',
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        accountStatus: 'ACTIVE',
      },
      // 프로그램당 한 사람은 한 팀에만 속한다(`TeamMember @@unique([programId, userId])`).
      // 팀이 둘이므로 신청자도 둘이어야 한다.
      {
        id: APPLICANT_A_ID,
        githubId: 9_320_000_002n,
        nickname: 'review-history-applicant-a',
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: 'ACTIVE',
      },
      {
        id: APPLICANT_B_ID,
        githubId: 9_320_000_003n,
        nickname: 'review-history-applicant-b',
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: 'ACTIVE',
      },
    ],
  });
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: '이력 writer 검증 프로그램',
      organizer: 'OSS Center',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: '이력 append 원자성 검증',
    },
  });
  for (const [teamId, applicationId, applicantId] of [
    [TEAM_A_ID, APPLICATION_A_ID, APPLICANT_A_ID],
    [TEAM_B_ID, APPLICATION_B_ID, APPLICANT_B_ID],
  ] as const) {
    await prisma.team.create({
      data: {
        id: teamId,
        programId: PROGRAM_ID,
        name: `팀 ${teamId}`,
        joinCodeDigest: `${teamId}-digest`,
        leaderId: applicantId,
      },
    });
    await prisma.teamMember.create({
      data: { teamId, programId: PROGRAM_ID, userId: applicantId },
    });
    await prisma.application.create({
      data: {
        id: applicationId,
        programId: PROGRAM_ID,
        applicantId,
        teamId,
        answers: {},
        applicationTemplateVersion: 1,
      },
    });
  }
}

function entry(eventKind: ApplicationReviewEventKind, applicationId: string) {
  return {
    applicationId,
    eventKind,
    actorId: ACTOR_ID,
    occurredAt: new Date('2026-09-20T03:00:00.000Z'),
    rejectionReason: null,
  };
}

describe('판정 이력 append writer — 트랜잭션 경계와 삭제 연쇄', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('상태 갱신 뒤 이력 insert가 실패하면 상태 갱신까지 함께 롤백된다', async () => {
    // Given: 판정 트랜잭션이 상태를 바꾸고 이력을 남기려는 순간 이력 쓰기가 깨진다.
    //        actorId가 존재하지 않는 사용자면 FK가 insert를 거부한다.
    const failure = await prisma
      .$transaction(async (transaction) => {
        await transaction.application.update({
          where: { id: APPLICATION_A_ID },
          data: { status: 'APPROVED' },
        });
        await appendReviewHistory(transaction, {
          ...entry(ApplicationReviewEventKind.APPROVED, APPLICATION_A_ID),
          actorId: `${PREFIX}absent-actor`,
        });
      })
      .then(() => null)
      .catch((caught: unknown) => caught);

    // Then: 예외가 나고, 상태 변경도 이력도 남지 않는다.
    expect(failure).not.toBeNull();
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: APPLICATION_A_ID },
    });
    expect(application.status).toBe('SUBMITTED');
    await expect(
      prisma.applicationReviewHistory.count({
        where: { applicationId: APPLICATION_A_ID },
      }),
    ).resolves.toBe(0);
  });

  it('회차 증가와 이력 행이 같은 커밋에 함께 들어간다', async () => {
    // When: 재제출 한 번이 한 트랜잭션으로 들어간다.
    await repository.withTransaction((store) =>
      store.appendReviewHistory(
        entry(ApplicationReviewEventKind.RESUBMITTED, APPLICATION_A_ID),
      ),
    );

    // Then: Application 회차와 이력 행의 회차가 같은 값으로 커밋됐다.
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: APPLICATION_A_ID },
      select: { revision: true },
    });
    const rows = await prisma.applicationReviewHistory.findMany({
      where: { applicationId: APPLICATION_A_ID },
    });
    expect(application.revision).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revision).toBe(2);
  });

  it('회차 증가가 커밋된 뒤 트랜잭션이 깨지면 증가도 되돌아간다', async () => {
    // Given / When
    const failure = await repository
      .withTransaction(async (store) => {
        await store.appendReviewHistory(
          entry(ApplicationReviewEventKind.RESUBMITTED, APPLICATION_A_ID),
        );
        throw new Error('synthetic post-append failure');
      })
      .then(() => null)
      .catch((caught: unknown) => caught);

    // Then
    expect(failure).not.toBeNull();
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: APPLICATION_A_ID },
      select: { revision: true },
    });
    expect(application.revision).toBe(1);
    await expect(
      prisma.applicationReviewHistory.count({
        where: { applicationId: APPLICATION_A_ID },
      }),
    ).resolves.toBe(0);
  });

  it('신청을 지우면 그 신청의 이력만 정확히 따라 사라진다', async () => {
    // Given: 같은 프로그램의 두 팀이 각자 이력을 쌓아 둔다.
    await repository.withTransaction(async (store) => {
      await store.appendReviewHistory(
        entry(ApplicationReviewEventKind.APPROVED, APPLICATION_A_ID),
      );
      await store.appendReviewHistory(
        entry(ApplicationReviewEventKind.APPROVED, APPLICATION_B_ID),
      );
    });

    // When: 팀 삭제 경로와 같은 모양으로 한쪽 신청만 지운다.
    await prisma.application.deleteMany({ where: { teamId: TEAM_A_ID } });

    // Then: 대상 이력은 cascade로 사라지고 비대상 이력은 그대로 남는다.
    await expect(
      prisma.applicationReviewHistory.count({
        where: { applicationId: APPLICATION_A_ID },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.applicationReviewHistory.count({
        where: { applicationId: APPLICATION_B_ID },
      }),
    ).resolves.toBe(1);
  });
});
