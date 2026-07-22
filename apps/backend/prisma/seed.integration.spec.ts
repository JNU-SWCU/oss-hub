import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { AccountStatus, Role } from '@prisma/client';
import { runProfile } from './seed';
import { AUTH_SCENARIOS } from './seeds/auth';
import { prisma, SeedStats, upsertSeedUser } from './seeds/helpers';

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

/** #110 시드가 실제로 건드리는 전체 모델. 카운트가 두 실행 사이에 흔들리면 멱등성이 깨진 것이다. */
const SEEDED_MODEL_COUNTERS: ReadonlyArray<
  [name: string, count: () => Promise<number>]
> = [
  ['User', () => prisma.user.count({ where: { id: { startsWith: 'seed:' } } })],
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

describe('seed profile=all 멱등성 (integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
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
