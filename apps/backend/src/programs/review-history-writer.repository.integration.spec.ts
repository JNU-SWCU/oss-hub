import { PlatformRepository } from '../platform/platform.repository';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { TeamHistoryEvent, ProgramCategory } from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { ApplicationsRepository } from './team.repository';
import { TeamHistoryRepository } from './team-history.repository';

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

const prisma = new PrismaService();
const repository = new ApplicationsRepository(
  prisma,
  new TeamHistoryRepository(),
  new RepositoryProvisionGenerationRepository(),
  new PlatformRepository(),
);

async function cleanup(): Promise<void> {
  await prisma.teamHistory.deleteMany({
    where: { teamId: { startsWith: PREFIX } },
  });
  await prisma.teamMember.deleteMany({
    where: { teamId: { startsWith: PREFIX } }
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
            githubId: 9320000001n,
            nickname: 'review-history-actor',
            accountStatus: 'ACTIVE',
            type: MemberKind.STAFF,
            approvalStatus: 'APPROVED',
            name: 'Synthetic staff',
            department: 'Synthetic department',
            profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
            profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
            departmentType: 'DEPARTMENT'
        },
        {
            id: APPLICANT_A_ID,
            githubId: 9320000002n,
            nickname: 'review-history-applicant-a',
            accountStatus: 'ACTIVE',
            type: MemberKind.STUDENT,
            approvalStatus: 'NOT_REQUIRED'
        },
        {
            id: APPLICANT_B_ID,
            githubId: 9320000003n,
            nickname: 'review-history-applicant-b',
            accountStatus: 'ACTIVE',
            type: MemberKind.STUDENT,
            approvalStatus: 'NOT_REQUIRED'
        }
    ]
});
  await prisma.program.create({
    data: {
        startAt: new Date('2026-01-01T00:00:00.000Z'),
        endAt: new Date(new Date('2026-12-31T00:00:00.000Z').getTime() + 365 * 86400000),
        id: PROGRAM_ID,
        name: '이력 writer 검증 프로그램',
        organizer: 'OSS Center',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
        description: '이력 append 원자성 검증'
    }
});
  for (const [teamId, applicantId] of [
    [TEAM_A_ID, APPLICANT_A_ID],
    [TEAM_B_ID, APPLICANT_B_ID],
  ] as const) {
    await prisma.team.create({
    data: {
        id: teamId,
        programId: PROGRAM_ID,
        name: `팀 ${teamId}`,
        leaderId: applicantId,
        applicantId: applicantId,
        answers: { title: `팀 ${teamId}` },
        applicationTemplateVersion: 1
    }
});
    await prisma.teamMember.create({
    data: { teamId, programId: PROGRAM_ID, userId: applicantId }
});
    await prisma.team.update({
    where: { id: teamId },
    data: {
        programId: PROGRAM_ID,
        applicantId,
        answers: {},
        applicationTemplateVersion: 1
    }
});
  }
}

function entry(eventKind: TeamHistoryEvent, teamId: string) {
  return {
    teamId,
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
    await prisma.$executeRawUnsafe(`ALTER TABLE "TeamHistory" ADD CONSTRAINT "synthetic_review_history_write_failure" CHECK ("teamId" <> '${TEAM_A_ID}')`);
    try {
      await expect(prisma.$transaction(async transaction => {
        await transaction.team.update({ where: { id: TEAM_A_ID }, data: { status: 'APPROVED' } });
        await new TeamHistoryRepository().appendReviewHistory(transaction, entry(TeamHistoryEvent.APPROVED, TEAM_A_ID));
      })).rejects.toThrow('synthetic_review_history_write_failure');
      expect(await prisma.team.findUniqueOrThrow({ where: { id: TEAM_A_ID } })).toMatchObject({ status: 'SUBMITTED' });
      expect(await prisma.teamHistory.count({ where: { teamId: TEAM_A_ID } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "TeamHistory" DROP CONSTRAINT "synthetic_review_history_write_failure"');
    }
  });

  it('회차 증가와 이력 행이 같은 커밋에 함께 들어간다', async () => {
    await repository.withTransaction((store) =>
      store.appendReviewHistory(
        entry(TeamHistoryEvent.RESUBMITTED, TEAM_A_ID),
      ),
    );

    const application = await prisma.team.findUniqueOrThrow({
    where: { id: TEAM_A_ID },
    select: { revision: true }
});
    const rows = await prisma.teamHistory.findMany({
      where: { teamId: TEAM_A_ID },
    });
    expect(application.revision).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({ revision: 2 });
  });

  it('회차 증가가 커밋된 뒤 트랜잭션이 깨지면 증가도 되돌아간다', async () => {
    const failure = await repository
      .withTransaction(async (store) => {
        await store.appendReviewHistory(
          entry(TeamHistoryEvent.RESUBMITTED, TEAM_A_ID),
        );
        throw new Error('synthetic post-append failure');
      })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(failure).not.toBeNull();
    const application = await prisma.team.findUniqueOrThrow({
    where: { id: TEAM_A_ID },
    select: { revision: true }
});
    expect(application.revision).toBe(1);
    await expect(
      prisma.teamHistory.count({
        where: { teamId: TEAM_A_ID },
      }),
    ).resolves.toBe(0);
  });

  it('팀을 지워도 해당 팀과 다른 팀의 판정 이력은 모두 보존된다', async () => {
    await repository.withTransaction(async (store) => {
      await store.appendReviewHistory(
        entry(TeamHistoryEvent.APPROVED, TEAM_A_ID),
      );
      await store.appendReviewHistory(
        entry(TeamHistoryEvent.APPROVED, TEAM_B_ID),
      );
    });

    await prisma.$transaction([
      prisma.teamMember.deleteMany({ where: { teamId: TEAM_A_ID } }),
      prisma.team.delete({ where: { id: TEAM_A_ID } }),
    ]);

    await expect(
      prisma.teamHistory.count({
        where: { teamId: TEAM_A_ID },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.teamHistory.count({
        where: { teamId: TEAM_B_ID },
      }),
    ).resolves.toBe(1);
  });
});
