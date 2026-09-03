import { AccountStatus, ApplicationStatus, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { MilestoneDocumentCollectionQuery } from './domain/milestone-document-collection-query';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';

/**
 * #1100 — 프로그램 상세의 교직원 배지(`n / m팀 제출`)와 서류 수합 표 합계 행이 **같은 모집단**을
 * 세는지 확인한다. 두 화면은 조회 경로가 다르다(배지는 SQL 집계 두 벌, 수합 표는 승인 신청으로
 * 행을 만든 뒤 메모리 집계). 그래서 한쪽만 고치면 화면끼리 어긋나는 것을 단위 테스트가 잡지
 * 못한다 — 같은 DB 상태를 두 경로로 읽어 대조하는 이 통합 테스트가 그 자리다.
 */
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prefix = 'milestone-badge-count';
const programId = `${prefix}-program`;
const milestoneId = `${prefix}-milestone`;
const requiredDocumentId = `${prefix}-document-required`;
const optionalDocumentId = `${prefix}-document-optional`;
const staffId = `${prefix}-staff`;
const staffGithubId = 9600000000998001n;

const prisma = new PrismaService();
const repository = new MilestoneDocumentsRepository(prisma);
const service = new MilestoneDocumentsService(repository);

const collectionQuery: MilestoneDocumentCollectionQuery = {
  page: 1,
  pageSize: 50,
  filter: 'ALL',
};

interface TeamFixture {
  /** 팀·신청·사용자 id를 만드는 접미사. 팀 이름 정렬이 흔들리지 않도록 그대로 이름에도 쓴다. */
  readonly key: string;
  readonly status: ApplicationStatus;
  /** 필수 서류를 제출한 팀인가 — 되돌린 신청도 제출 행은 남는다는 것이 이 티켓의 전제다. */
  readonly submitsRequiredDocument: boolean;
}

/** 자식 행 → 부모 행 순서. 통합 러너는 DB를 공유하므로 이 prefix 밖은 건드리지 않는다. */
async function cleanup(): Promise<void> {
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { milestoneDocument: { milestoneId } },
  });
  await prisma.application.deleteMany({ where: { programId } });
  await prisma.teamMember.deleteMany({ where: { programId } });
  await prisma.team.deleteMany({ where: { programId } });
  await prisma.milestoneDocument.deleteMany({ where: { milestoneId } });
  await prisma.milestone.deleteMany({ where: { id: milestoneId } });
  await prisma.program.deleteMany({ where: { id: programId } });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function createTeams(teams: readonly TeamFixture[]): Promise<void> {
  let githubSeed = 9600000000998100n;
  for (const team of teams) {
    const userId = `${prefix}-${team.key}-user`;
    githubSeed += 1n;
    await prisma.user.create({
      data: {
        id: userId,
        githubId: githubSeed,
        nickname: `${prefix}-${team.key}`,
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
    });
    const teamId = `${prefix}-${team.key}-team`;
    await prisma.team.create({
      data: {
        id: teamId,
        programId,
        name: `synthetic ${team.key} 팀`,
        joinCodeDigest: `digest:${prefix}:${team.key}`,
        leaderId: userId,
      },
    });
    await prisma.teamMember.create({
      data: {
        id: `${prefix}-${team.key}-member`,
        teamId,
        programId,
        userId,
      },
    });
    const applicationId = `${prefix}-${team.key}-application`;
    await prisma.application.create({
      data: {
        id: applicationId,
        programId,
        applicantId: userId,
        teamId,
        answers: { syntheticFixture: true },
        applicationTemplateVersion: 1,
        status: team.status,
        processedAt: new Date('2026-02-01'),
      },
    });
    if (team.submitsRequiredDocument) {
      await prisma.milestoneDocumentSubmission.create({
        data: {
          id: `${prefix}-${team.key}-submission`,
          milestoneDocumentId: requiredDocumentId,
          applicationId,
          submittedById: userId,
          submittedAt: new Date('2026-03-01'),
        },
      });
    }
  }
}

/** 프로그램 상세 배지 — 교직원 뷰의 `teamSubmissionCount`. */
async function readBadge(
  documentId: string,
): Promise<{ readonly submitted: number; readonly total: number }> {
  const documents = await service.listForViewer(staffGithubId, milestoneId);
  const badge = documents.find(
    (document) => document.id === documentId,
  )?.teamSubmissionCount;
  if (badge === undefined) {
    throw new Error(`배지가 없습니다: ${documentId}`);
  }
  return { submitted: badge.submitted, total: badge.total };
}

/** 서류 수합 표 합계 행 — 같은 서류(열)의 진척. */
async function readCollectionTotal(
  documentId: string,
): Promise<{ readonly submitted: number; readonly total: number }> {
  const collection = await service.collectForStaff(
    milestoneId,
    collectionQuery,
  );
  const total = collection.documentTotals.find(
    (row) => row.documentId === documentId,
  );
  if (total === undefined) {
    throw new Error(`수합 표 합계 행이 없습니다: ${documentId}`);
  }
  return { submitted: total.submitted, total: total.total };
}

describe('교직원 서류 제출 카운트 — 배지와 수합 표 합계', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
    await prisma.user.create({
      data: {
        id: staffId,
        githubId: staffGithubId,
        nickname: `${prefix}-staff`,
        selectedMemberKind: MemberKind.STAFF,
        accountStatus: AccountStatus.ACTIVE,
        hasStaffAccess: true,
      },
    });
    await prisma.program.create({
      data: {
        id: programId,
        name: 'synthetic badge count program',
        organizer: 'OSS Hub',
        category: 'CAPSTONE',
        applicationTemplateKey: 'capstone-v1',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2025-12-01'),
        applicationEndAt: new Date('2026-01-01'),
        startAt: new Date('2026-01-02'),
        endAt: new Date('2026-12-31'),
        description: 'synthetic integration fixture',
        milestones: {
          create: {
            id: milestoneId,
            name: 'synthetic milestone',
            dueAt: new Date('2026-11-01'),
            submissionType: 'FILE',
          },
        },
      },
    });
    await prisma.milestoneDocument.createMany({
      data: [
        {
          id: requiredDocumentId,
          milestoneId,
          name: '필수 서류',
          required: true,
          sortOrder: 1,
        },
        {
          id: optionalDocumentId,
          milestoneId,
          name: '선택 서류',
          required: false,
          sortOrder: 2,
        },
      ],
    });
  });

  it('승인을 검토 대기로 되돌린 뒤에도 배지의 앞 수가 뒤 수를 넘지 않고 수합 표 합계와 같다', async () => {
    // Given: 두 팀이 승인 뒤 제출했고, 그중 한 팀만 승인을 되돌려 SUBMITTED로 돌아갔다.
    // 되돌려도 제출 행은 남는다(#1100 전제) — 그래서 제출 수만 세면 승인 수를 넘는다.
    await createTeams([
      {
        key: 'kept',
        status: ApplicationStatus.APPROVED,
        submitsRequiredDocument: true,
      },
      {
        key: 'reverted',
        status: ApplicationStatus.SUBMITTED,
        submitsRequiredDocument: true,
      },
    ]);

    // When
    const badge = await readBadge(requiredDocumentId);
    const collectionTotal = await readCollectionTotal(requiredDocumentId);

    // Then
    expect(badge.submitted).toBeLessThanOrEqual(badge.total);
    expect(badge).toEqual({ submitted: 1, total: 1 });
    expect(badge).toEqual(collectionTotal);
  });

  it('승인 팀이 하나뿐인데 그 승인을 되돌리면 배지가 0 / 0팀 제출이 된다', async () => {
    // Given: 티켓이 지목한 「1 / 0팀 제출」 그 자리.
    await createTeams([
      {
        key: 'only',
        status: ApplicationStatus.SUBMITTED,
        submitsRequiredDocument: true,
      },
    ]);

    // When
    const badge = await readBadge(requiredDocumentId);
    const collectionTotal = await readCollectionTotal(requiredDocumentId);

    // Then
    expect(badge).toEqual({ submitted: 0, total: 0 });
    expect(badge).toEqual(collectionTotal);
  });

  it('반려된 신청이 섞여도 배지와 수합 표 합계가 어긋나지 않는다', async () => {
    // Given: 반려 팀도 되돌리기와 같다 — 승인 모집단 밖인데 제출 행은 남아 있다.
    await createTeams([
      {
        key: 'approved-submitted',
        status: ApplicationStatus.APPROVED,
        submitsRequiredDocument: true,
      },
      {
        key: 'approved-missing',
        status: ApplicationStatus.APPROVED,
        submitsRequiredDocument: false,
      },
      {
        key: 'rejected',
        status: ApplicationStatus.REJECTED,
        submitsRequiredDocument: true,
      },
    ]);

    // When
    const badge = await readBadge(requiredDocumentId);
    const collectionTotal = await readCollectionTotal(requiredDocumentId);

    // Then
    expect(badge).toEqual({ submitted: 1, total: 2 });
    expect(badge).toEqual(collectionTotal);
  });

  it('되돌리기가 없는 흐름에서는 배지 수가 그대로다', async () => {
    // Given: 승인만 있는 기존 흐름 — 이 티켓의 수정이 값을 바꾸지 않아야 하는 회귀 기준선.
    await createTeams([
      {
        key: 'first',
        status: ApplicationStatus.APPROVED,
        submitsRequiredDocument: true,
      },
      {
        key: 'second',
        status: ApplicationStatus.APPROVED,
        submitsRequiredDocument: true,
      },
      {
        key: 'third',
        status: ApplicationStatus.APPROVED,
        submitsRequiredDocument: false,
      },
    ]);

    // When
    const requiredBadge = await readBadge(requiredDocumentId);
    const optionalBadge = await readBadge(optionalDocumentId);

    // Then
    expect(requiredBadge).toEqual({ submitted: 2, total: 3 });
    expect(requiredBadge).toEqual(
      await readCollectionTotal(requiredDocumentId),
    );
    // 아무도 내지 않은 열도 분모는 승인 신청 수 그대로다.
    expect(optionalBadge).toEqual({ submitted: 0, total: 3 });
    expect(optionalBadge).toEqual(
      await readCollectionTotal(optionalDocumentId),
    );
  });
});
