import {
  AffiliationKind,
  ApplicationReviewEventKind,
  ApplicationStatus,
  MemberKind,
  ProgramCategory,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { ApplicationListQuery } from './application-list-query';
import { ApplicationsRepository } from './applications.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;

const PREFIX = 'test:staff-read-paths:';
const PROGRAM_ID = `${PREFIX}program`;
const STAFF_ID = `${PREFIX}staff`;

/**
 * 네 팀의 제출 시각과 상태를 일부러 엇갈리게 둔다.
 *
 * `SUBMITTED 우선 → submittedAt ASC → id ASC` 계약과 「상태 enum 선언 순서로 묶는」
 * 구현을 **가르는** 배치다. 후자면 APPROVED(01-04)가 REJECTED(01-02)보다 앞서지만,
 * 계약대로면 검토대기 뒤는 상태와 무관하게 제출 시각 순이다.
 */
const FIXTURES = [
  { key: 'a', status: ApplicationStatus.SUBMITTED, submittedAt: '2026-01-03' },
  { key: 'b', status: ApplicationStatus.SUBMITTED, submittedAt: '2026-01-01' },
  { key: 'c', status: ApplicationStatus.APPROVED, submittedAt: '2026-01-04' },
  { key: 'd', status: ApplicationStatus.REJECTED, submittedAt: '2026-01-02' },
] as const;

const EXPECTED_ORDER = [
  `${PREFIX}application-b`,
  `${PREFIX}application-a`,
  `${PREFIX}application-d`,
  `${PREFIX}application-c`,
];

/** 팀 c 에만 있는 팀원 — 대표 신청자가 아니라 팀원 축으로만 검색에 걸린다. */
const SEARCH_ONLY_MEMBER_NAME = '검색전용팀원이름';
const SEARCH_ONLY_MEMBER_NICKNAME = 'search-only-login';

const prisma = new PrismaService();
const repository = new ApplicationsRepository(prisma, {
  TEAM_JOIN_CODE_SECRET: 'synthetic-staff-read-paths-secret',
});

function query(overrides: Partial<ApplicationListQuery> = {}) {
  return {
    page: 1,
    pageSize: 20,
    search: '',
    status: 'all',
    view: 'team-management',
    ...overrides,
  } satisfies ApplicationListQuery;
}

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
  await prisma.userProfile.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

async function createStudent(
  id: string,
  githubId: bigint,
  nickname: string,
  name: string,
): Promise<void> {
  await prisma.user.create({
    data: {
      id,
      githubId,
      nickname,
      selectedMemberKind: MemberKind.STUDENT,
      accountStatus: 'ACTIVE',
      profile: {
        create: {
          name,
          studentId: `${900000 + Number(githubId % 1000n)}`,
          department: '합성 학과',
          memberKind: MemberKind.STUDENT,
          affiliationKind: AffiliationKind.DEPARTMENT,
          affiliationName: '합성 학과',
        },
      },
    },
  });
}

async function seed(): Promise<void> {
  await prisma.user.create({
    data: {
      id: STAFF_ID,
      githubId: 9_410_000_000n,
      nickname: 'staff-reviewer',
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      accountStatus: 'ACTIVE',
      profile: {
        create: {
          name: '합성 교직원',
          studentId: null,
          department: '합성 지원단',
          memberKind: MemberKind.STAFF,
          affiliationKind: AffiliationKind.PROGRAM_OFFICE,
          affiliationName: '합성 지원단',
        },
      },
    },
  });
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: '교직원 읽기 경로 검증 프로그램',
      organizer: 'OSS Center',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'lean projection 과 검토 이력 읽기 검증',
    },
  });

  let githubSeq = 9_410_000_001n;
  for (const fixture of FIXTURES) {
    const teamId = `${PREFIX}team-${fixture.key}`;
    const leaderId = `${PREFIX}leader-${fixture.key}`;
    await createStudent(
      leaderId,
      githubSeq,
      `leader-${fixture.key}`,
      `팀장 ${fixture.key}`,
    );
    githubSeq += 1n;
    await prisma.team.create({
      data: {
        id: teamId,
        programId: PROGRAM_ID,
        name: `팀 ${fixture.key}`,
        joinCodeDigest: `${teamId}-digest`,
        leaderId,
      },
    });
    await prisma.teamMember.create({
      data: { teamId, programId: PROGRAM_ID, userId: leaderId },
    });
    if (fixture.key === 'c') {
      const memberId = `${PREFIX}member-c`;
      await createStudent(
        memberId,
        githubSeq,
        SEARCH_ONLY_MEMBER_NICKNAME,
        SEARCH_ONLY_MEMBER_NAME,
      );
      githubSeq += 1n;
      await prisma.teamMember.create({
        data: { teamId, programId: PROGRAM_ID, userId: memberId },
      });
    }
    await prisma.application.create({
      data: {
        id: `${PREFIX}application-${fixture.key}`,
        programId: PROGRAM_ID,
        applicantId: leaderId,
        teamId,
        answers: { applicantName: `팀장 ${fixture.key}`, title: '제목' },
        applicationTemplateVersion: 1,
        status: fixture.status,
        submittedAt: new Date(`${fixture.submittedAt}T00:00:00.000Z`),
        rejectionReason:
          fixture.status === ApplicationStatus.REJECTED ? '서류 미비' : null,
      },
    });
  }
}

describe('교직원 읽기 경로 — lean 목록 projection 과 검토 이력', () => {
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

  it('검토대기를 앞세우되 그 뒤는 상태가 아니라 제출 시각 순이다', async () => {
    // When
    const page = await repository.listTeamManagementForProgram(
      PROGRAM_ID,
      query(),
    );

    // Then
    expect(page.items.map((item) => item.id)).toEqual(EXPECTED_ORDER);
    expect(page.totalItems).toBe(4);
    expect(page.totalPages).toBe(1);
  });

  it('상태 필터와 결합해도 같은 정렬이 유지된다', async () => {
    // When
    const page = await repository.listTeamManagementForProgram(
      PROGRAM_ID,
      query({ status: 'SUBMITTED' }),
    );

    // Then
    expect(page.items.map((item) => item.id)).toEqual([
      `${PREFIX}application-b`,
      `${PREFIX}application-a`,
    ]);
    expect(page.totalItems).toBe(2);
  });

  it('페이지를 나눠도 전체 순서가 이어지고 count 와 어긋나지 않는다', async () => {
    // When
    const [first, second] = await Promise.all([
      repository.listTeamManagementForProgram(
        PROGRAM_ID,
        query({ pageSize: 2, page: 1 }),
      ),
      repository.listTeamManagementForProgram(
        PROGRAM_ID,
        query({ pageSize: 2, page: 2 }),
      ),
    ]);

    // Then: 두 페이지를 이어 붙이면 단일 페이지 순서와 같다 — 중복도 누락도 없다.
    expect([
      ...first.items.map((item) => item.id),
      ...second.items.map((item) => item.id),
    ]).toEqual(EXPECTED_ORDER);
    expect(first.totalItems).toBe(4);
    expect(first.totalPages).toBe(2);
    expect(second.totalItems).toBe(4);
  });

  it('팀원 이름으로만 일치하는 팀도 검색 결과에 들어온다', async () => {
    // When: 대표 신청자가 아니라 팀원의 실명이다.
    const page = await repository.listTeamManagementForProgram(
      PROGRAM_ID,
      query({ search: SEARCH_ONLY_MEMBER_NAME }),
    );

    // Then
    expect(page.items.map((item) => item.id)).toEqual([
      `${PREFIX}application-c`,
    ]);
  });

  it('팀원 GitHub 계정으로만 일치하는 팀도 대소문자 무관하게 들어온다', async () => {
    // When
    const page = await repository.listTeamManagementForProgram(
      PROGRAM_ID,
      query({ search: SEARCH_ONLY_MEMBER_NICKNAME.toUpperCase() }),
    );

    // Then
    expect(page.items.map((item) => item.id)).toEqual([
      `${PREFIX}application-c`,
    ]);
  });

  it('팀 구성원 표시 이름 목록을 실어 「팀/구성」 열을 채운다', async () => {
    // When
    const page = await repository.listTeamManagementForProgram(
      PROGRAM_ID,
      query({ search: SEARCH_ONLY_MEMBER_NAME }),
    );

    // Then
    expect(page.items[0]?.team).toMatchObject({
      name: '팀 c',
      memberCount: 2,
    });
    expect(page.items[0]?.team?.members.map((member) => member.name)).toEqual([
      '팀장 c',
      SEARCH_ONLY_MEMBER_NAME,
    ]);
  });

  it('lean projection 은 저장소 어휘를 아예 담지 않는다', async () => {
    // When
    const page = await repository.listTeamManagementForProgram(
      PROGRAM_ID,
      query(),
    );

    // Then: 응답에서 지우는 게 아니라 애초에 읽지 않는다.
    const serialized = JSON.stringify(page);
    for (const forbidden of [
      'repositoryConnectionMode',
      'repositoryUrl',
      'repositoryProvisioning',
      'repository',
      'nameWithOwner',
      'joinCodeDigest',
      'studentId',
      'department',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('기존 목록 projection 의 응답 모양은 그대로다 — 중간 배포에서 옛 화면이 산다', async () => {
    // When
    const page = await repository.listApplicationsForProgram(
      PROGRAM_ID,
      query({ view: 'default' }),
    );

    // Then: 저장소 필드가 여전히 있다(제거는 PR3 몫이다).
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        repositoryConnectionMode: expect.any(String) as unknown,
        repositoryProvisioning: expect.any(Object) as unknown,
      }),
    );
    expect(page.items[0]).toHaveProperty('repositoryUrl');
    expect(page.items[0]).toHaveProperty('repository');
  });

  it('검토 이력을 최신순으로 돌려주고 표시 가능한 actor 값만 싣는다', async () => {
    // Given: 같은 신청에 세 사건이 쌓였다.
    const applicationId = `${PREFIX}application-a`;
    await prisma.applicationReviewHistory.createMany({
      data: [
        {
          id: `${PREFIX}history-1`,
          applicationId,
          eventKind: ApplicationReviewEventKind.SUBMITTED,
          revision: 1,
          actorId: `${PREFIX}leader-a`,
          occurredAt: new Date('2026-01-03T00:00:00.000Z'),
        },
        {
          id: `${PREFIX}history-2`,
          applicationId,
          eventKind: ApplicationReviewEventKind.REJECTED,
          revision: 1,
          actorId: STAFF_ID,
          occurredAt: new Date('2026-01-05T00:00:00.000Z'),
          rejectionReason: '서류 미비',
        },
        {
          id: `${PREFIX}history-3`,
          applicationId,
          eventKind: ApplicationReviewEventKind.RESUBMITTED,
          revision: 2,
          actorId: `${PREFIX}leader-a`,
          occurredAt: new Date('2026-01-07T00:00:00.000Z'),
        },
      ],
    });

    // When
    const history = await repository.listReviewHistory(applicationId);

    // Then
    expect(history.map((entry) => entry.eventKind)).toEqual([
      'RESUBMITTED',
      'REJECTED',
      'SUBMITTED',
    ]);
    expect(history[1]).toMatchObject({
      revision: 1,
      rejectionReason: '서류 미비',
      actor: { name: '합성 교직원', nickname: 'staff-reviewer' },
    });
    // 학번·소속·연락처는 projection 이 읽지 않는다.
    const serialized = JSON.stringify(history);
    for (const forbidden of ['studentId', 'department', 'githubId', 'email']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('다른 신청의 이력은 섞이지 않는다', async () => {
    // Given
    await prisma.applicationReviewHistory.create({
      data: {
        id: `${PREFIX}history-other`,
        applicationId: `${PREFIX}application-b`,
        eventKind: ApplicationReviewEventKind.SUBMITTED,
        revision: 1,
        actorId: `${PREFIX}leader-b`,
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    // When / Then
    await expect(
      repository.listReviewHistory(`${PREFIX}application-a`),
    ).resolves.toEqual([]);
    await expect(
      repository.listReviewHistory(`${PREFIX}application-b`),
    ).resolves.toHaveLength(1);
  });

  it('없는 신청은 이력도 빈 배열이고 신청 조회도 null 이다 — 부재와 비공개가 같은 모양이다', async () => {
    // When / Then
    await expect(
      repository.listReviewHistory(`${PREFIX}application-missing`),
    ).resolves.toEqual([]);
    await expect(
      repository.findApplicationForStaff(`${PREFIX}application-missing`),
    ).resolves.toBeNull();
  });

  it('다른 프로그램의 신청은 목록에 섞이지 않는다', async () => {
    // Given: 같은 모양의 신청이 다른 프로그램에 있다.
    const otherProgramId = `${PREFIX}program-other`;
    const otherLeaderId = `${PREFIX}leader-other`;
    await createStudent(otherLeaderId, 9_410_000_900n, 'leader-other', '팀장 z');
    await prisma.program.create({
      data: {
        id: otherProgramId,
        name: '다른 프로그램',
        organizer: 'OSS Center',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
        description: '섞임 검증',
      },
    });
    await prisma.team.create({
      data: {
        id: `${PREFIX}team-other`,
        programId: otherProgramId,
        name: '팀 z',
        joinCodeDigest: `${PREFIX}team-other-digest`,
        leaderId: otherLeaderId,
      },
    });
    await prisma.teamMember.create({
      data: {
        teamId: `${PREFIX}team-other`,
        programId: otherProgramId,
        userId: otherLeaderId,
      },
    });
    await prisma.application.create({
      data: {
        id: `${PREFIX}application-other`,
        programId: otherProgramId,
        applicantId: otherLeaderId,
        teamId: `${PREFIX}team-other`,
        answers: {},
        applicationTemplateVersion: 1,
      },
    });

    // When
    const page = await repository.listTeamManagementForProgram(
      PROGRAM_ID,
      query(),
    );

    // Then
    expect(page.items.map((item) => item.id)).toEqual(EXPECTED_ORDER);
  });
});
