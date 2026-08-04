import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  AccountStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  ReviewDecision,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { runProfile } from './seed';
import { AUTH_SCENARIOS } from './seeds/auth';
import { prisma, seedId, SeedStats, upsertSeedUser } from './seeds/helpers';
import { CONSENT_POLICY_VERSION } from '../src/consents/domain/consent-policy';
import { resolveCompatibleProfile } from '../src/profiles/profile-compatibility';
import { isCompleteUserProfile } from '../src/users/user-profile-policy';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const SEED_RUN_TIMEOUT_MS = 60_000;
const ISSUE99_OLDER_POLICY_VERSION = '2025-12';
const consentRequiredUserId = AUTH_SCENARIOS['consent-required'];
const roleUnselectedUserId = AUTH_SCENARIOS['user-role-unselected'];
const profileCompleteUserId = AUTH_SCENARIOS['profile-complete'];
const staffPendingUserId = AUTH_SCENARIOS['staff-pending'];
const staffRejectedUserId = AUTH_SCENARIOS['staff-rejected'];
const staffRevokedUserId = AUTH_SCENARIOS['staff-revoked'];
// displayName(4번째 세그먼트)은 합성 fixture 이름만 쓴다 — 실명은 절대 넣지 않는다.
const OSS_HUB_TEAM_ACCOUNTS = [
  '9800000000000001:seed-operator-alpha:ADMIN:시드운영자알파',
  '9800000000000002:seed-operator-beta:ADMIN:시드운영자베타',
  '9800000000000003:seed-operator-gamma:ADMIN:시드운영자감마',
  '9800000000000004:seed-operator-delta:ADMIN:시드운영자델타',
].join(',');
const OSS_HUB_TEAM_ACCOUNT_DISPLAY_NAMES = [
  '시드운영자알파',
  '시드운영자베타',
  '시드운영자감마',
  '시드운영자델타',
];
const OSS_HUB_TEAM_ACCOUNT_GITHUB_IDS = [
  9800000000000001n,
  9800000000000002n,
  9800000000000003n,
  9800000000000004n,
];
const OSS_HUB_TEAM_ACCOUNT_USER_IDS = OSS_HUB_TEAM_ACCOUNT_GITHUB_IDS.map(
  (githubId) => seedId('oss-hub', 'user', githubId.toString()),
);
const OSS_HUB_PROGRAM_ID = seedId('oss-hub', 'program');
const OSS_HUB_TEAM_ID = seedId('oss-hub', 'team');
const OSS_HUB_APPLICATION_ID = seedId('oss-hub', 'application');
const OSS_HUB_REPOSITORY_ID = seedId('oss-hub', 'repository');
const OSS_HUB_PROVISION_JOB_ID = seedId('oss-hub', 'provision-job');
const OSS_HUB_REPOSITORY_URL = 'https://github.com/JNU-SWCU/oss-hub';
/** JNU-SWCU/oss-hub 공개 저장소의 실제 GitHub numeric id (GitHub REST API로 확인, public 정보). */
const OSS_HUB_GITHUB_REPOSITORY_ID = 1297138137n;
const OSS_HUB_PRACTICE_PROGRAM_ID = seedId('oss-hub-practice', 'program');
const OSS_HUB_PRACTICE_TEAM_ID = seedId('oss-hub-practice', 'team');
const OSS_HUB_PRACTICE_APPLICATION_ID = seedId(
  'oss-hub-practice',
  'application',
);
const OSS_HUB_PRACTICE_REPOSITORY_ID = seedId('oss-hub-practice', 'repository');
const OSS_HUB_PRACTICE_PROVISION_JOB_ID = seedId(
  'oss-hub-practice',
  'provision-job',
);
const OSS_HUB_PRACTICE_REPOSITORY_URL =
  'https://github.com/JNU-SWCU/oss-hub-practice';
/** JNU-SWCU/oss-hub-practice 공개 저장소의 실제 GitHub numeric id (GitHub REST API로 확인, public 정보). */
const OSS_HUB_PRACTICE_GITHUB_REPOSITORY_ID = 1296567792n;
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

  beforeEach(() => {
    process.env.OSS_HUB_TEAM_ACCOUNTS = OSS_HUB_TEAM_ACCOUNTS;
    process.env.OSS_HUB_SEED_CONFIRMATION = 'NON_PRODUCTION';
  });

  afterEach(() => {
    delete process.env.OSS_HUB_TEAM_ACCOUNTS;
    delete process.env.OSS_HUB_SEED_CONFIRMATION;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('명시적 확인값 없이는 oss-hub profile 실행을 거부한다', async () => {
    // Given: 격리 DB와 계정 설정은 있지만 운영자 확인값이 없다.
    delete process.env.OSS_HUB_SEED_CONFIRMATION;

    // When & Then: import한 runProfile 경로도 DB 쓰기 전에 거부한다.
    await expect(runProfile('oss-hub', new SeedStats())).rejects.toThrow(
      /OSS_HUB_SEED_CONFIRMATION/,
    );
  });

  it(
    '합성 auth 계정과 설정된 ADMIN 네 명의 프로그램 추적 데이터를 멱등하게 만든다',
    async () => {
      // Given: 격리된 빈 DB와 공개 안전한 합성 운영자 계정 설정.
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
        application,
        awsStagingSubmission,
        intakeFreezeSubmission,
        repository,
        provisionJob,
        practiceProgram,
        practiceTeam,
        practiceApplication,
        practiceRepository,
        practiceProvisionJob,
        configuredUsersConsentCount,
        ossHubProgramCount,
        ossHubTeamCount,
        ossHubMemberCount,
        ossHubMilestoneCount,
        ossHubApplicationCount,
        ossHubSubmissionCount,
        ossHubSubmissionRevisionCount,
        ossHubReviewCount,
        ossHubRepositoryCount,
        ossHubRepositoryProvisionJobCount,
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
          where: { githubId: { in: OSS_HUB_TEAM_ACCOUNT_GITHUB_IDS } },
          orderBy: { githubId: 'asc' },
          include: { profile: true },
        }),
        prisma.program.findUniqueOrThrow({
          where: { id: OSS_HUB_PROGRAM_ID },
          include: { milestones: { orderBy: { id: 'asc' } } },
        }),
        prisma.team.findUniqueOrThrow({
          where: { id: OSS_HUB_TEAM_ID },
          include: { members: { orderBy: { id: 'asc' } } },
        }),
        prisma.application.findUniqueOrThrow({
          where: { id: OSS_HUB_APPLICATION_ID },
        }),
        prisma.submission.findUniqueOrThrow({
          where: { id: seedId('oss-hub', 'submission', 'aws-staging') },
          include: { revisions: { include: { review: true } } },
        }),
        prisma.submission.findUniqueOrThrow({
          where: { id: seedId('oss-hub', 'submission', 'intake-freeze') },
          include: { revisions: { include: { review: true } } },
        }),
        prisma.repository.findUniqueOrThrow({
          where: { id: OSS_HUB_REPOSITORY_ID },
        }),
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { id: OSS_HUB_PROVISION_JOB_ID },
        }),
        prisma.program.findUniqueOrThrow({
          where: { id: OSS_HUB_PRACTICE_PROGRAM_ID },
        }),
        prisma.team.findUniqueOrThrow({
          where: { id: OSS_HUB_PRACTICE_TEAM_ID },
          include: { members: { orderBy: { id: 'asc' } } },
        }),
        prisma.application.findUniqueOrThrow({
          where: { id: OSS_HUB_PRACTICE_APPLICATION_ID },
        }),
        prisma.repository.findUniqueOrThrow({
          where: { id: OSS_HUB_PRACTICE_REPOSITORY_ID },
        }),
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { id: OSS_HUB_PRACTICE_PROVISION_JOB_ID },
        }),
        prisma.consent.count({
          where: {
            userId: { in: OSS_HUB_TEAM_ACCOUNT_USER_IDS },
            policyVersion: CONSENT_POLICY_VERSION,
          },
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
        prisma.application.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.submission.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.submissionRevision.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.review.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.repository.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.repositoryProvisionJob.count({
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
        configuredUsers.map(({ id, nickname, role, name, accountStatus }) => ({
          id,
          nickname,
          role,
          name,
          accountStatus,
        })),
      ).toEqual([
        {
          id: seedId('oss-hub', 'user', '9800000000000001'),
          nickname: 'seed-operator-alpha',
          role: Role.ADMIN,
          name: '시드운영자알파',
          accountStatus: AccountStatus.ACTIVE,
        },
        {
          id: seedId('oss-hub', 'user', '9800000000000002'),
          nickname: 'seed-operator-beta',
          role: Role.ADMIN,
          name: '시드운영자베타',
          accountStatus: AccountStatus.ACTIVE,
        },
        {
          id: seedId('oss-hub', 'user', '9800000000000003'),
          nickname: 'seed-operator-gamma',
          role: Role.ADMIN,
          name: '시드운영자감마',
          accountStatus: AccountStatus.ACTIVE,
        },
        {
          id: seedId('oss-hub', 'user', '9800000000000004'),
          nickname: 'seed-operator-delta',
          role: Role.ADMIN,
          name: '시드운영자델타',
          accountStatus: AccountStatus.ACTIVE,
        },
      ]);
      // 네 계정 모두 실제 로그인 게이트(`auth.repository.ts`의 isProfileComplete)와 동일한
      // 정책 함수로 온보딩 완료가 판정된다 — 규칙을 여기서 다시 인코딩하지 않는다.
      for (const configuredUser of configuredUsers) {
        expect(
          isCompleteUserProfile({
            id: configuredUser.id,
            ...resolveCompatibleProfile(configuredUser),
            role: configuredUser.role,
          }),
        ).toBe(true);
      }
      expect(configuredUsers.map(({ name }) => name)).toEqual(
        OSS_HUB_TEAM_ACCOUNT_DISPLAY_NAMES,
      );
      // Consent — 4명 모두 현행 정책 버전으로 동의 완료 상태다.
      expect(configuredUsersConsentCount).toBe(4);
      expect([ossHubProgramCount, ossHubTeamCount, ossHubMemberCount]).toEqual([
        1, 1, 4,
      ]);
      for (const noticeExample of OSS_HUB_NOTICE_EXAMPLES) {
        expect(program.description).toContain(noticeExample);
      }
      expect(program.repositoryProvisioningEnabled).toBe(true);
      // 마일스톤 전체 arc(Notion "📅 Schedule" DB 기준, id asc 정렬): AWS Staging →
      // Full-loop Dry-run → 구현 마감 → Intake 기능 동결 → Intake Gate → Full-loop Live Beta →
      // Release Complete.
      expect(ossHubMilestoneCount).toBe(7);
      expect(program.milestones.map(({ id }) => id)).toEqual([
        seedId('oss-hub', 'milestone', 'aws-staging'),
        seedId('oss-hub', 'milestone', 'dry-run'),
        seedId('oss-hub', 'milestone', 'implementation-deadline'),
        seedId('oss-hub', 'milestone', 'intake-freeze'),
        seedId('oss-hub', 'milestone', 'intake-gate'),
        seedId('oss-hub', 'milestone', 'live-beta'),
        seedId('oss-hub', 'milestone', 'release-complete'),
      ]);
      expect(team.leaderId).toBe(configuredUsers[0]?.id);
      expect(team.members.map(({ id, userId }) => ({ id, userId }))).toEqual(
        configuredUsers.map((user) => ({
          id: seedId('oss-hub', 'team-member', user.githubId.toString()),
          userId: user.id,
        })),
      );

      // 팀의 프로그램 신청 — Submission·Repository·RepositoryProvisionJob이 매달리는 backbone.
      expect(ossHubApplicationCount).toBe(1);
      expect(application).toMatchObject({
        teamId: OSS_HUB_TEAM_ID,
        applicantId: configuredUsers[0]?.id,
        status: ApplicationStatus.APPROVED,
      });

      // aws-staging: 승인 리뷰까지 완료된 제출.
      expect(ossHubSubmissionCount).toBe(2);
      expect(ossHubSubmissionRevisionCount).toBe(2);
      expect(ossHubReviewCount).toBe(1);
      expect(awsStagingSubmission).toMatchObject({
        status: SubmissionStatus.APPROVED,
        currentRevision: 1,
      });
      expect(awsStagingSubmission.revisions).toHaveLength(1);
      expect(awsStagingSubmission.revisions[0]?.review).toMatchObject({
        decision: ReviewDecision.APPROVED,
        reviewerId: AUTH_SCENARIOS['staff-approved'],
      });

      // intake-freeze: 제출은 있지만 아직 리뷰 대기 중(review 없음).
      expect(intakeFreezeSubmission).toMatchObject({
        status: SubmissionStatus.SUBMITTED,
        currentRevision: 1,
      });
      expect(intakeFreezeSubmission.revisions).toHaveLength(1);
      expect(intakeFreezeSubmission.revisions[0]?.review).toBeNull();

      // 저장소 — 실제 공개 저장소를 연결·공개 완료 상태로 추적한다.
      expect(ossHubRepositoryCount).toBe(1);
      expect(repository).toMatchObject({
        applicationId: OSS_HUB_APPLICATION_ID,
        teamId: OSS_HUB_TEAM_ID,
        githubRepositoryId: OSS_HUB_GITHUB_REPOSITORY_ID,
        url: OSS_HUB_REPOSITORY_URL,
        visibility: RepositoryVisibility.PUBLIC,
      });
      expect(ossHubRepositoryProvisionJobCount).toBe(1);
      expect(provisionJob).toMatchObject({
        applicationId: OSS_HUB_APPLICATION_ID,
        repositoryId: OSS_HUB_REPOSITORY_ID,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });

      // oss-hub-practice — 별도 Program·Team·Application·Repository 체인(학생 fork/배포
      // 퀘스트 실습용). `Application_programId_teamId_team_key` partial unique index(같은
      // 팀은 같은 Program에 신청을 한 건만 낼 수 있다 — 마이그레이션 SQL에만 있고 Prisma
      // schema에는 표현되지 않는다) 때문에 기존 oss-hub Program·Team을 재사용할 수 없어
      // 같은 네 명의 ADMIN 계정으로 별도 Program·Team을 새로 만든다.
      expect(practiceProgram.repositoryProvisioningEnabled).toBe(true);
      expect(practiceTeam.leaderId).toBe(configuredUsers[0]?.id);
      expect(
        practiceTeam.members.map(({ id, userId }) => ({ id, userId })),
      ).toEqual(
        configuredUsers.map((user) => ({
          id: seedId(
            'oss-hub-practice',
            'team-member',
            user.githubId.toString(),
          ),
          userId: user.id,
        })),
      );
      expect(practiceApplication).toMatchObject({
        programId: OSS_HUB_PRACTICE_PROGRAM_ID,
        teamId: OSS_HUB_PRACTICE_TEAM_ID,
        applicantId: configuredUsers[0]?.id,
        status: ApplicationStatus.APPROVED,
      });
      expect(practiceRepository).toMatchObject({
        applicationId: OSS_HUB_PRACTICE_APPLICATION_ID,
        programId: OSS_HUB_PRACTICE_PROGRAM_ID,
        teamId: OSS_HUB_PRACTICE_TEAM_ID,
        githubRepositoryId: OSS_HUB_PRACTICE_GITHUB_REPOSITORY_ID,
        url: OSS_HUB_PRACTICE_REPOSITORY_URL,
        visibility: RepositoryVisibility.PUBLIC,
      });
      expect(practiceRepository.publishedAt).not.toBeNull();
      expect(practiceProvisionJob).toMatchObject({
        applicationId: OSS_HUB_PRACTICE_APPLICATION_ID,
        repositoryId: OSS_HUB_PRACTICE_REPOSITORY_ID,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it(
    '이전 마일스톤 구성이 남긴 제출·리뷰가 있어도 FK 오류 없이 정리하고 새 7개로 수렴한다',
    async () => {
      // Given: profile을 한 번 실행해 프로그램을 만든 뒤, 실제 배포 DB에 남아있을 법한
      // "구버전 마일스톤 + 제출 + 리비전 + 리뷰"를 수동으로 심는다. Milestone.submissions,
      // Submission.revisions, SubmissionRevision.review는 모두 onDelete 미지정(RESTRICT)이라
      // 이 자식들이 남아 있는 채로 마일스톤을 지우면 FK 위반이 나야 정상이다.
      await runProfile('oss-hub', new SeedStats());
      const staleMilestoneId = seedId('oss-hub', 'milestone', 'legacy-plan');
      await prisma.milestone.create({
        data: {
          id: staleMilestoneId,
          programId: OSS_HUB_PROGRAM_ID,
          name: '구버전 계획서 제출',
          dueAt: new Date('2026-01-01T00:00:00+09:00'),
          submissionType: MilestoneSubmissionType.TEXT,
          instructions: '마이그레이션 테스트용 구버전 마일스톤(legacy-plan).',
        },
      });
      const staleSubmissionId = seedId('oss-hub', 'submission', 'legacy-plan');
      await prisma.submission.create({
        data: {
          id: staleSubmissionId,
          milestoneId: staleMilestoneId,
          applicationId: OSS_HUB_APPLICATION_ID,
          status: SubmissionStatus.SUBMITTED,
          currentRevision: 1,
        },
      });
      const staleRevisionId = seedId(
        'oss-hub',
        'submission',
        'legacy-plan',
        'revision-1',
      );
      await prisma.submissionRevision.create({
        data: {
          id: staleRevisionId,
          submissionId: staleSubmissionId,
          revision: 1,
          submissionType: MilestoneSubmissionType.TEXT,
          content: {
            type: MilestoneSubmissionType.TEXT,
            text: '구버전 제출 (migration test).',
          },
          submittedById: AUTH_SCENARIOS['staff-approved'],
        },
      });
      const staleReviewId = seedId(
        'oss-hub',
        'submission',
        'legacy-plan',
        'review',
      );
      await prisma.review.create({
        data: {
          id: staleReviewId,
          submissionRevisionId: staleRevisionId,
          reviewerId: AUTH_SCENARIOS['staff-approved'],
          decision: ReviewDecision.APPROVED,
          comment: '구버전 리뷰 (migration test).',
        },
      });

      // When: oss-hub profile을 다시 실행한다 — 새 7개 마일스톤을 upsert하기 전에 stale
      // 마일스톤과 그 자식(Review → SubmissionRevision → Submission)을 먼저 지워야 한다.
      await expect(
        runProfile('oss-hub', new SeedStats()),
      ).resolves.not.toThrow();

      // Then: 구버전 마일스톤/제출/리비전/리뷰가 모두 사라지고, 이 프로그램의 마일스톤은
      // 새 7개만 남는다 — orphan도, FK 위반도 없다.
      const [
        staleMilestone,
        staleSubmission,
        staleRevision,
        staleReview,
        milestoneCount,
      ] = await Promise.all([
        prisma.milestone.findUnique({ where: { id: staleMilestoneId } }),
        prisma.submission.findUnique({ where: { id: staleSubmissionId } }),
        prisma.submissionRevision.findUnique({
          where: { id: staleRevisionId },
        }),
        prisma.review.findUnique({ where: { id: staleReviewId } }),
        prisma.milestone.count({ where: { programId: OSS_HUB_PROGRAM_ID } }),
      ]);
      expect(staleMilestone).toBeNull();
      expect(staleSubmission).toBeNull();
      expect(staleRevision).toBeNull();
      expect(staleReview).toBeNull();
      expect(milestoneCount).toBe(7);
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
            policyVersion: CONSENT_POLICY_VERSION,
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
        CONSENT_POLICY_VERSION,
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
