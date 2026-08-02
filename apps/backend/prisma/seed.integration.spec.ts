import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { AccountStatus, Role } from '@prisma/client';
import { runProfile } from './seed';
import { AUTH_SCENARIOS } from './seeds/auth';
import { prisma, seedId, SeedStats, upsertSeedUser } from './seeds/helpers';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const SEED_RUN_TIMEOUT_MS = 60_000;
const ISSUE99_POLICY_VERSION = '2026-07-21';
const ISSUE99_OLDER_POLICY_VERSION = '2025-12';
const consentRequiredUserId = AUTH_SCENARIOS['consent-required'];
const roleUnselectedUserId = AUTH_SCENARIOS['user-role-unselected'];
const profileCompleteUserId = AUTH_SCENARIOS['profile-complete'];
const staffPendingUserId = AUTH_SCENARIOS['staff-pending'];
const staffRejectedUserId = AUTH_SCENARIOS['staff-rejected'];
const staffRevokedUserId = AUTH_SCENARIOS['staff-revoked'];
const OSS_HUB_TEAM_ACCOUNTS = [
  '9800000000000001:seed-operator-alpha:ADMIN',
  '9800000000000002:seed-operator-beta:ADMIN',
  '9800000000000003:seed-operator-gamma:ADMIN',
  '9800000000000004:seed-operator-delta:ADMIN',
].join(',');
const OSS_HUB_PROGRAM_ID = seedId('oss-hub', 'program');
const OSS_HUB_TEAM_ID = seedId('oss-hub', 'team');
const OSS_HUB_NOTICE_EXAMPLES = [
  '[모집홍보] 2026 오픈소스 개발자대회 모집 안내',
  '｢모집홍보｣ 『LLMOps 파이프라인 개발』 교육 2026학년 2학기 자유학기(자유교과목) 신청 안내',
  'https://sojoong.kr/notice/notice-board/?mod=document&uid=922',
  'https://sojoong.kr/notice/notice-board/?mod=document&uid=939',
] as const;

/** #110 시드가 실제로 건드리는 전체 모델. 카운트가 두 실행 사이에 흔들리면 멱등성이 깨진 것이다. */
const SEEDED_MODEL_COUNTERS: ReadonlyArray<
  [name: string, count: () => Promise<number>]
> = [
  ['User', () => prisma.user.count({ where: { id: { startsWith: 'seed:' } } })],
  [
    'UserProfile',
    () =>
      prisma.userProfile.count({
        where: { userId: { startsWith: 'seed:' } },
      }),
  ],
  [
    'RoleRequest',
    () => prisma.roleRequest.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'Consent',
    () => prisma.consent.count({ where: { userId: { startsWith: 'seed:' } } }),
  ],
  [
    'Program',
    () => prisma.program.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'Milestone',
    () => prisma.milestone.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'Application',
    () => prisma.application.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  ['Team', () => prisma.team.count({ where: { id: { startsWith: 'seed:' } } })],
  [
    'TeamMember',
    () => prisma.teamMember.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'Submission',
    () => prisma.submission.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'SubmissionRevision',
    () =>
      prisma.submissionRevision.count({
        where: { id: { startsWith: 'seed:' } },
      }),
  ],
  [
    'Review',
    () => prisma.review.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'Repository',
    () => prisma.repository.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'RepositoryInvitation',
    () =>
      prisma.repositoryInvitation.count({
        where: { id: { startsWith: 'seed:' } },
      }),
  ],
  [
    'OutboxEvent',
    () => prisma.outboxEvent.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'RepositoryProvisionJob',
    () =>
      prisma.repositoryProvisionJob.count({
        where: { id: { startsWith: 'seed:' } },
      }),
  ],
];

async function countAllSeeded(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    SEEDED_MODEL_COUNTERS.map(
      async ([name, count]) => [name, await count()] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/**
 * F4 QA 감사 — 이 describe가 `runProfile('all')`을 두 번 실행해 심는 `seed:` 행 전부를
 * 여기서 정리한다. 정리하지 않으면 이 파일이 남긴 PUBLIC Repository 등 fixture가 다른
 * integration spec(예: public-exposure-persona)의 assertion과 섞여 실행 순서에 따라
 * 간헐 실패한다. FK 자식→부모 순서로 지운다:
 *   Review → SubmissionRevision → Submission
 *   → RepositoryProvisionJob → RepositoryInvitation → OutboxEvent → Repository
 *   → TeamMember → Milestone → Application → Team → Program
 *   → RoleRequest → Consent → UserProfile → User
 *
 * 이 파일이 만들지 않는 AuditLog(append-only)·Notification·LoginHistory·
 * SubmissionFile은 다른 spec이 이 파일과 같은 `seed:` User/Application/Milestone을
 * actor·uploader·부모로 참조할 수 있고, 그 FK는 RESTRICT다. 그런 행을 참조당하는
 * 부모는 삭제 대상에서 제외해 다른 spec의 데이터를 건드리지 않으면서 FK violation
 * 없이 정리한다.
 */
async function deleteAllSeeded(): Promise<void> {
  const seedPrefix = 'seed:';
  const seedIdFilter = { id: { startsWith: seedPrefix } } as const;

  const [
    submissionFilesByApplication,
    submissionFilesByMilestone,
    auditLogActors,
    notificationUsers,
    loginHistoryUsers,
    submissionFileUploaders,
  ] = await Promise.all([
    prisma.submissionFile.findMany({
      where: { applicationId: { startsWith: seedPrefix } },
      select: { applicationId: true },
      distinct: ['applicationId'],
    }),
    prisma.submissionFile.findMany({
      where: { milestoneId: { startsWith: seedPrefix } },
      select: { milestoneId: true },
      distinct: ['milestoneId'],
    }),
    prisma.auditLog.findMany({
      where: { actorId: { startsWith: seedPrefix } },
      select: { actorId: true },
      distinct: ['actorId'],
    }),
    prisma.notification.findMany({
      where: { userId: { startsWith: seedPrefix } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.loginHistory.findMany({
      where: { userId: { startsWith: seedPrefix } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.submissionFile.findMany({
      where: { uploaderId: { startsWith: seedPrefix } },
      select: { uploaderId: true },
      distinct: ['uploaderId'],
    }),
  ]);

  const protectedApplicationIds = new Set(
    submissionFilesByApplication
      .map((row) => row.applicationId)
      .filter((id): id is string => id !== null),
  );
  const protectedMilestoneIds = new Set(
    submissionFilesByMilestone
      .map((row) => row.milestoneId)
      .filter((id): id is string => id !== null),
  );
  const protectedUserIds = new Set([
    ...auditLogActors.map((row) => row.actorId),
    ...notificationUsers.map((row) => row.userId),
    ...loginHistoryUsers.map((row) => row.userId),
    ...submissionFileUploaders.map((row) => row.uploaderId),
  ]);

  const excluding = (protectedIds: Set<string>) =>
    protectedIds.size > 0 ? { NOT: { id: { in: [...protectedIds] } } } : {};

  await prisma.review.deleteMany({ where: seedIdFilter });
  await prisma.submissionRevision.deleteMany({ where: seedIdFilter });
  await prisma.submission.deleteMany({ where: seedIdFilter });
  await prisma.repositoryProvisionJob.deleteMany({ where: seedIdFilter });
  await prisma.repositoryInvitation.deleteMany({ where: seedIdFilter });
  await prisma.outboxEvent.deleteMany({ where: seedIdFilter });
  await prisma.repository.deleteMany({ where: seedIdFilter });
  await prisma.teamMember.deleteMany({ where: seedIdFilter });
  await prisma.milestone.deleteMany({
    where: { ...seedIdFilter, ...excluding(protectedMilestoneIds) },
  });
  await prisma.application.deleteMany({
    where: { ...seedIdFilter, ...excluding(protectedApplicationIds) },
  });
  await prisma.team.deleteMany({ where: seedIdFilter });
  await prisma.program.deleteMany({ where: seedIdFilter });
  await prisma.roleRequest.deleteMany({ where: seedIdFilter });
  await prisma.consent.deleteMany({
    where: { userId: { startsWith: seedPrefix } },
  });
  await prisma.userProfile.deleteMany({
    where: { userId: { startsWith: seedPrefix } },
  });
  await prisma.user.deleteMany({
    where: { ...seedIdFilter, ...excluding(protectedUserIds) },
  });
}
describe('seed profile=oss-hub contract (integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
    delete process.env.OSS_HUB_TEAM_ACCOUNTS;
    await prisma.$disconnect();
  });

  it(
    '합성 auth 계정과 설정된 ADMIN 네 명의 프로그램 추적 데이터를 멱등하게 만든다',
    async () => {
      // Given: 격리된 빈 DB와 공개 안전한 합성 운영자 계정 설정.
      process.env.OSS_HUB_TEAM_ACCOUNTS = OSS_HUB_TEAM_ACCOUNTS;

      // When: oss-hub profile을 두 번 실행한다.
      await runProfile('oss-hub', new SeedStats());
      const countsAfterFirstRun = await countAllSeeded();
      await runProfile('oss-hub', new SeedStats());
      const countsAfterSecondRun = await countAllSeeded();

      // Then: 기존 auth 역할 계정과 정확한 oss-hub 관계 shape가 유지된다.
      const [
        syntheticAdmin,
        syntheticStaff,
        syntheticStudent,
        configuredUsers,
        program,
        team,
        ossHubProgramCount,
        ossHubTeamCount,
        ossHubMemberCount,
        ossHubMilestoneCount,
      ] = await Promise.all([
        prisma.user.findUniqueOrThrow({
          where: { id: AUTH_SCENARIOS['admin-confirmed'] },
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: AUTH_SCENARIOS['staff-approved'] },
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: AUTH_SCENARIOS['student-confirmed'] },
        }),
        prisma.user.findMany({
          where: {
            githubId: {
              in: [
                9800000000000001n,
                9800000000000002n,
                9800000000000003n,
                9800000000000004n,
              ],
            },
          },
          orderBy: { githubId: 'asc' },
        }),
        prisma.program.findUniqueOrThrow({
          where: { id: OSS_HUB_PROGRAM_ID },
          include: { milestones: { orderBy: { id: 'asc' } } },
        }),
        prisma.team.findUniqueOrThrow({
          where: { id: OSS_HUB_TEAM_ID },
          include: { members: { orderBy: { id: 'asc' } } },
        }),
        prisma.program.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.team.count({ where: { id: { startsWith: 'seed:oss-hub:' } } }),
        prisma.teamMember.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.milestone.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
      ]);

      expect(countsAfterSecondRun).toEqual(countsAfterFirstRun);
      expect([
        syntheticAdmin.role,
        syntheticStaff.role,
        syntheticStudent.role,
      ]).toEqual([Role.ADMIN, Role.STAFF, Role.STUDENT]);
      expect(configuredUsers).toHaveLength(4);
      expect(
        configuredUsers.map(({ id, nickname, role }) => ({
          id,
          nickname,
          role,
        })),
      ).toEqual([
        {
          id: seedId('oss-hub', 'user', '9800000000000001'),
          nickname: 'seed-operator-alpha',
          role: Role.ADMIN,
        },
        {
          id: seedId('oss-hub', 'user', '9800000000000002'),
          nickname: 'seed-operator-beta',
          role: Role.ADMIN,
        },
        {
          id: seedId('oss-hub', 'user', '9800000000000003'),
          nickname: 'seed-operator-gamma',
          role: Role.ADMIN,
        },
        {
          id: seedId('oss-hub', 'user', '9800000000000004'),
          nickname: 'seed-operator-delta',
          role: Role.ADMIN,
        },
      ]);
      expect([ossHubProgramCount, ossHubTeamCount, ossHubMemberCount]).toEqual([
        1, 1, 4,
      ]);
      for (const noticeExample of OSS_HUB_NOTICE_EXAMPLES) {
        expect(program.description).toContain(noticeExample);
      }
      expect(ossHubMilestoneCount).toBe(2);
      expect(program.milestones.map(({ id }) => id)).toEqual([
        seedId('oss-hub', 'milestone', 'checkpoint'),
        seedId('oss-hub', 'milestone', 'kickoff'),
      ]);
      expect(team.leaderId).toBe(configuredUsers[0]?.id);
      expect(team.members.map(({ id, userId }) => ({ id, userId }))).toEqual(
        configuredUsers.map((user) => ({
          id: seedId('oss-hub', 'team-member', user.githubId.toString()),
          userId: user.id,
        })),
      );
    },
    SEED_RUN_TIMEOUT_MS,
  );
});

describe('seed profile=all 멱등성 (integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
    await deleteAllSeeded();
    await prisma.$disconnect();
  });

  it(
    '같은 profile을 두 번 실행해도 seed: 행 수가 그대로다',
    async () => {
      // Given: 격리된 빈 DB(마이그레이션만 적용된 상태).

      // When: profile=all을 두 번 연속 실행한다.
      const firstRunStats = new SeedStats();
      await runProfile('all', firstRunStats);
      const countsAfterFirstRun = await countAllSeeded();

      const secondRunStats = new SeedStats();
      await runProfile('all', secondRunStats);
      const countsAfterSecondRun = await countAllSeeded();

      // Then: 각 모델의 seed: 행 수는 두 실행 사이에 변하지 않고, 최소한 하나는 non-zero다
      // (멱등성뿐 아니라 "조용한 no-op"이 아님도 함께 검증한다).
      expect(countsAfterSecondRun).toEqual(countsAfterFirstRun);
      const totalRows = Object.values(countsAfterSecondRun).reduce(
        (sum, count) => sum + count,
        0,
      );
      expect(totalRows).toBeGreaterThan(0);

      // 두 실행 모두 created/updated 합계가 0보다 커야 한다 — stats 리포트 자체가 비어있지 않음을 보장.
      expect(firstRunStats.report().length).toBeGreaterThan(0);
      expect(secondRunStats.report().length).toBeGreaterThan(0);
    },
    SEED_RUN_TIMEOUT_MS,
  );
});

describe('issue-99 auth seed contract', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
    await prisma.consent.deleteMany({
      where: {
        userId: { in: [consentRequiredUserId, roleUnselectedUserId] },
      },
    });
    await prisma.$disconnect();
  });

  it(
    'auth profile은 미동의·현행 동의·과거 버전을 두 실행 뒤에도 보존한다',
    async () => {
      // Given: 대상 사용자만 준비하고 동의 행은 과거 버전 하나로 초기화한다.
      const setupStats = new SeedStats();
      await upsertSeedUser(setupStats, {
        id: consentRequiredUserId,
        role: null,
      });
      await upsertSeedUser(setupStats, {
        id: roleUnselectedUserId,
        role: null,
      });
      await prisma.consent.deleteMany({
        where: {
          userId: { in: [consentRequiredUserId, roleUnselectedUserId] },
        },
      });
      const olderConsent = await prisma.consent.create({
        data: {
          userId: roleUnselectedUserId,
          policyVersion: ISSUE99_OLDER_POLICY_VERSION,
        },
      });

      // When: auth profile을 두 번 실행한다.
      await runProfile('auth', new SeedStats());
      const firstCurrent = await prisma.consent.findUnique({
        where: {
          userId_policyVersion: {
            userId: roleUnselectedUserId,
            policyVersion: ISSUE99_POLICY_VERSION,
          },
        },
      });
      await runProfile('auth', new SeedStats());

      // Then: 미동의 사용자는 비어 있고, 현행/과거 행은 중복·갱신 없이 남는다.
      const [
        consentRequiredCount,
        roleUnselectedRows,
        profileComplete,
        profileCompleteNormalized,
        staffPending,
        staffRejected,
        staffRevoked,
      ] = await Promise.all([
        prisma.consent.count({ where: { userId: consentRequiredUserId } }),
        prisma.consent.findMany({
          where: { userId: roleUnselectedUserId },
          orderBy: { policyVersion: 'asc' },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: profileCompleteUserId } }),
        prisma.userProfile.findUniqueOrThrow({
          where: { userId: profileCompleteUserId },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: staffPendingUserId } }),
        prisma.user.findUniqueOrThrow({ where: { id: staffRejectedUserId } }),
        prisma.user.findUniqueOrThrow({ where: { id: staffRevokedUserId } }),
      ]);
      expect(consentRequiredCount).toBe(0);
      expect(firstCurrent).not.toBeNull();
      expect(roleUnselectedRows.map((row) => row.policyVersion)).toEqual([
        ISSUE99_OLDER_POLICY_VERSION,
        ISSUE99_POLICY_VERSION,
      ]);
      expect(roleUnselectedRows[0]?.consentedAt).toEqual(
        olderConsent.consentedAt,
      );
      expect(roleUnselectedRows[1]?.consentedAt).toEqual(
        firstCurrent?.consentedAt,
      );
      expect(profileComplete).toMatchObject({
        name: '합성 완료 사용자',
        studentId: ['20', '2601'].join(''),
        department: '인공지능학부',
      });
      expect(profileCompleteNormalized).toMatchObject({
        name: '합성 완료 사용자',
        studentId: ['20', '2601'].join(''),
        department: '인공지능학부',
      });
      expect(staffPending).toMatchObject({
        studentId: '202602',
        department: '인공지능학부',
      });
      expect(staffRejected).toMatchObject({
        studentId: '202604',
        department: '컴퓨터공학과',
      });
      expect(staffRevoked).toMatchObject({
        role: Role.STAFF,
        accountStatus: AccountStatus.DEACTIVATED,
      });
    },
    SEED_RUN_TIMEOUT_MS,
  );
});
