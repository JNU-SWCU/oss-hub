import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { AccountStatus, AffiliationKind, ApplicationStatus, MemberKind, MilestoneSubmissionType, ProgramCategory, RepositoryProvisionJobStatus, RepositoryVisibility, ReviewDecision, StaffAccessRequestStatus, SubmissionStatus } from '@prisma/client';
import { runProfile, runTeardown } from './seed';
import { AUTH_SCENARIOS } from './seeds/auth';
import {
  prisma,
  seedGithubId,
  seedId,
  SeedStats,
  upsertSeedUser,
} from './seeds/helpers';
import { computeJoinCodeDigest } from '../src/common/join-code-digest';
import { AuthConfig } from '../src/auth/auth.config';
import { AuthRepository } from '../src/auth/auth.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { CONSENT_POLICY_VERSION } from '../src/consents/domain/consent-policy';
import { resolveUserProfile } from '../src/profiles/user-profile-read';
import { isCompleteUserProfile } from '../src/users/user-profile-policy';
import { repositoryUrlFromNameWithOwner } from '../src/github/repository-identity';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3SubmissionFileStorage } from '../src/submissions/s3-submission-file.storage';
import { SubmissionFileStorageConfig } from '../src/submissions/submission-file-storage.config';
import { KNOWN_STORAGE_PREFIXES } from '../src/submissions/storage-orphan-reconciliation';
import {
  USER_PROFILE_BACKFILL_ERROR_KIND,
  backfillUserProfiles,
} from './user-profile-backfill';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;

// demo profile이 실제로 쓰는 객체와 동일한 포트/설정을 재사용해 실제 업로드된 객체가
// 조회 가능한지 직접 S3(MinIO)로 검증한다(#910/#913 파인딩 4).
const demoStorageConfig = new SubmissionFileStorageConfig();
const demoStorage = new S3SubmissionFileStorage(demoStorageConfig);
let demoStorageS3Client: S3Client | undefined;
function demoStorageS3(): S3Client {
  if (demoStorageS3Client) return demoStorageS3Client;
  const settings = demoStorageConfig.requireSettings();
  demoStorageS3Client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
  return demoStorageS3Client;
}
async function demoStorageObjectExists(key: string): Promise<boolean> {
  const settings = demoStorageConfig.requireSettings();
  try {
    await demoStorageS3().send(
      new HeadObjectCommand({ Bucket: settings.bucket, Key: key }),
    );
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw error;
  }
}
const SEED_RUN_TIMEOUT_MS = 60_000;
const ISSUE99_OLDER_POLICY_VERSION = '2025-12';
const consentRequiredUserId = AUTH_SCENARIOS['consent-required'];
const roleUnselectedUserId = AUTH_SCENARIOS['user-role-unselected'];
const profileCompleteUserId = AUTH_SCENARIOS['profile-complete'];
const staffPendingUserId = AUTH_SCENARIOS['staff-pending'];
const staffRejectedUserId = AUTH_SCENARIOS['staff-rejected'];
const staffRevokedUserId = AUTH_SCENARIOS['staff-revoked'];
const staffRevocableUserId = AUTH_SCENARIOS['staff-revocable'];
const adminConfirmedUserId = AUTH_SCENARIOS['admin-confirmed'];
const adminSecondUserId = AUTH_SCENARIOS['admin-second'];
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
    'StaffAccessRequest',
    () => prisma.staffAccessRequest.count({ where: { id: { startsWith: 'seed:' } } }),
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
    () =>
      prisma.githubRepository.count({ where: { id: { startsWith: 'seed:' } } }),
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
  [
    'MilestoneDocument',
    () =>
      prisma.milestoneDocument.count({
        where: { id: { startsWith: 'seed:' } },
      }),
  ],
  [
    'MilestoneDocumentTemplateFile',
    () =>
      prisma.milestoneDocumentTemplateFile.count({
        where: { id: { startsWith: 'seed:' } },
      }),
  ],
  [
    'MilestoneDocumentSubmission',
    () =>
      prisma.milestoneDocumentSubmission.count({
        where: { id: { startsWith: 'seed:' } },
      }),
  ],
  [
    'BoardPost',
    () => prisma.boardPost.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'BoardComment',
    () => prisma.boardComment.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'TeamInvitation',
    () =>
      prisma.teamInvitation.count({ where: { id: { startsWith: 'seed:' } } }),
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
 *   (자신이 참조하는) SubmissionFile → Review → SubmissionRevision → Submission
 *   → RepositoryProvisionJob → RepositoryInvitation → OutboxEvent → Repository
 *   → MilestoneDocumentSubmission → MilestoneDocumentTemplateFile → MilestoneDocument
 *   → BoardComment → BoardPost → TeamInvitation
 *   → TeamMember → Milestone → Application → Team → Program
 *   → StaffAccessRequest → Consent → UserProfile → User
 *
 * program-overview 프로필은 서류 제출 예시를 위해 자신의 MilestoneDocumentSubmission을
 * 참조하는 SubmissionFile을 함께 심는다. 이 행은 milestoneDocumentSubmissionId FK가
 * ON DELETE SET NULL이라, 미리 지우지 않으면 부모 삭제 시 두 참조(submissionRevisionId·
 * milestoneDocumentSubmissionId)가 모두 NULL이 되어 lifecycle CHECK 제약을 위반한다.
 * 그 외 이 파일이 만들지 않는 AuditLog(append-only)·Notification·LoginHistory·
 * SubmissionFile은 다른 spec이 이 파일과 같은 `seed:` User/Application/Milestone을
 * actor·uploader·부모로 참조할 수 있고, 그 FK는 RESTRICT다. 그런 행을 참조당하는
 * 부모는 삭제 대상에서 제외해 다른 spec의 데이터를 건드리지 않으면서 FK violation
 * 없이 정리한다.
 */
async function deleteAllSeeded(): Promise<void> {
  const seedPrefix = 'seed:';
  const seedIdFilter = { id: { startsWith: seedPrefix } } as const;

  // program-overview 프로필이 자신의 MilestoneDocumentSubmission에 붙여 심은
  // SubmissionFile은 이 파일 자신의 Application/Milestone도 함께 가리킨다.
  // protected*Ids 조회보다 먼저 지워야 그 조회가 이 행을 "다른 spec이 참조 중"으로
  // 오인해 자신의 Milestone/Application을 보호 대상으로 남기지 않는다.
  await prisma.submissionFile.deleteMany({
    where: { milestoneDocumentSubmissionId: { startsWith: seedPrefix } },
  });

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
  await prisma.githubRepository.deleteMany({ where: seedIdFilter });
  await prisma.milestoneDocumentSubmission.deleteMany({ where: seedIdFilter });
  await prisma.milestoneDocumentTemplateFile.deleteMany({
    where: seedIdFilter,
  });
  await prisma.milestoneDocument.deleteMany({ where: seedIdFilter });
  await prisma.boardComment.deleteMany({ where: seedIdFilter });
  await prisma.boardPost.deleteMany({ where: seedIdFilter });
  await prisma.teamInvitation.deleteMany({ where: seedIdFilter });
  await prisma.teamMember.deleteMany({ where: seedIdFilter });
  await prisma.milestone.deleteMany({
    where: { ...seedIdFilter, ...excluding(protectedMilestoneIds) },
  });
  await prisma.application.deleteMany({
    where: { ...seedIdFilter, ...excluding(protectedApplicationIds) },
  });
  await prisma.team.deleteMany({ where: seedIdFilter });
  await prisma.program.deleteMany({ where: seedIdFilter });
  await prisma.staffAccessRequest.deleteMany({ where: seedIdFilter });
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
        prisma.githubRepository.findUniqueOrThrow({
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
        prisma.githubRepository.findUniqueOrThrow({
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
        prisma.githubRepository.count({
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
      ]).toEqual(['ADMIN', 'STAFF', 'STUDENT']);
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
          hasAdminAccess: true,
          accountStatus: AccountStatus.ACTIVE,
        },
        {
          id: seedId('oss-hub', 'user', '9800000000000002'),
          nickname: 'seed-operator-beta',
          hasAdminAccess: true,
          accountStatus: AccountStatus.ACTIVE,
        },
        {
          id: seedId('oss-hub', 'user', '9800000000000003'),
          nickname: 'seed-operator-gamma',
          hasAdminAccess: true,
          accountStatus: AccountStatus.ACTIVE,
        },
        {
          id: seedId('oss-hub', 'user', '9800000000000004'),
          nickname: 'seed-operator-delta',
          hasAdminAccess: true,
          accountStatus: AccountStatus.ACTIVE,
        },
      ]);
      // 네 계정 모두 실제 로그인 게이트(`auth.repository.ts`의 isProfileComplete)와 동일한
      // 정책 함수로 온보딩 완료가 판정된다 — 규칙을 여기서 다시 인코딩하지 않는다.
      for (const configuredUser of configuredUsers) {
        expect(
          isCompleteUserProfile({
            id: configuredUser.id,
            ...resolveUserProfile(configuredUser),
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
      expect(
        program.milestones.find(
          ({ id }) => id === seedId('oss-hub', 'milestone', 'live-beta'),
        ),
      ).toMatchObject({
        startAt: new Date('2026-08-27T00:00:00+09:00'),
        dueAt: new Date('2026-08-31T00:00:00+09:00'),
      });
      for (const milestone of program.milestones) {
        expect(milestone.startAt.getTime()).toBeGreaterThanOrEqual(
          program.startAt.getTime(),
        );
        expect(milestone.startAt.getTime()).toBeLessThan(
          milestone.dueAt.getTime(),
        );
        expect(milestone.dueAt.getTime()).toBeLessThan(program.endAt.getTime());
      }
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
        visibility: RepositoryVisibility.PUBLIC,
      });
      expect(repositoryUrlFromNameWithOwner(repository.nameWithOwner)).toBe(
        OSS_HUB_REPOSITORY_URL,
      );
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
        visibility: RepositoryVisibility.PUBLIC,
      });
      expect(
        repositoryUrlFromNameWithOwner(practiceRepository.nameWithOwner),
      ).toBe(OSS_HUB_PRACTICE_REPOSITORY_URL);
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

/**
 * qa-econovation-batch TODO 11 — demo profile 계약 검증.
 *   ① 두 번 실행해도 seed:demo: 행 수가 그대로다(멱등) ② GithubRepository·Contribution은
 *   이 profile이 절대 만들지 않는다(0건) ③ production에서는 SEED_DEMO_ALLOW_PRODUCTION=1 없이는
 *   거부되고, 있으면 허용된다(DB 쓰기 전에 거부하므로 실제 실행은 하지 않고 거부 여부만 단언).
 */
describe('seed profile=demo 계약 (integration)', () => {
  const seedDemoPrefix = 'seed:demo:';

  /** demo profile이 만지는 모든 테이블 — teardown 잔여 0건 검증(TODO 15)도 이 목록을 재사용한다. */
  async function countDemoSeeded(): Promise<Record<string, number>> {
    const [
      users,
      programs,
      teams,
      teamMembers,
      applications,
      milestones,
      submissions,
      submissionRevisions,
      submissionFiles,
      reviews,
      boardPosts,
      boardComments,
      githubRepositories,
      contributions,
    ] = await Promise.all([
      prisma.user.count({ where: { id: { startsWith: seedDemoPrefix } } }),
      prisma.program.count({ where: { id: { startsWith: seedDemoPrefix } } }),
      prisma.team.count({ where: { id: { startsWith: seedDemoPrefix } } }),
      prisma.teamMember.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.application.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.milestone.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.submission.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.submissionRevision.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.submissionFile.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.review.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.boardPost.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.boardComment.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.githubRepository.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      // Contribution은 결정적 seedId 문자열 PK가 없다(repositoryId+githubId+date 복합키) —
      // 이 profile이 만드는 seed:demo: User의 githubId로 존재 여부를 직접 확인한다.
      prisma.contribution.count({
        where: {
          githubId: {
            in: await prisma.user
              .findMany({
                where: { id: { startsWith: seedDemoPrefix } },
                select: { githubId: true },
              })
              .then((rows) => rows.map((row) => row.githubId)),
          },
        },
      }),
    ]);
    return {
      User: users,
      Program: programs,
      Team: teams,
      TeamMember: teamMembers,
      Application: applications,
      Milestone: milestones,
      Submission: submissions,
      SubmissionRevision: submissionRevisions,
      SubmissionFile: submissionFiles,
      Review: reviews,
      BoardPost: boardPosts,
      BoardComment: boardComments,
      GithubRepository: githubRepositories,
      Contribution: contributions,
    };
  }

  async function deleteDemoSeeded(): Promise<void> {
    const seedIdFilter = { id: { startsWith: seedDemoPrefix } } as const;
    // DB row를 지우기 전에 storageKey를 먼저 읽어둔다 — 이 헬퍼는 teardownDemo를 호출하지
    // 않고 row만 직접 지우므로, 여기서 storage 객체도 함께 정리하지 않으면
    // 이 describe가 만든 객체가 같은 Jest 프로세스 내 다른 integration spec(reconciliation
    // 등)으로 새어 오염된다(#910/#913 파인딩 4 회귀).
    const demoFileStorageKeys = (
      await prisma.submissionFile.findMany({
        where: seedIdFilter,
        select: { storageKey: true },
      })
    ).map((file) => file.storageKey);
    // SubmissionFile.submissionRevisionId는 onDelete 미지정(RESTRICT)이라
    // SubmissionRevision보다 먼저 지워야 한다(FILE 타입 마일스톤 제출이 만드는 행).
    // Review는 SubmissionRevision을 참조하므로 그보다 먼저 지운다.
    await prisma.review.deleteMany({ where: seedIdFilter });
    await prisma.submissionFile.deleteMany({ where: seedIdFilter });
    await prisma.submissionRevision.deleteMany({ where: seedIdFilter });
    await prisma.submission.deleteMany({ where: seedIdFilter });
    await prisma.boardComment.deleteMany({ where: seedIdFilter });
    await prisma.boardPost.deleteMany({ where: seedIdFilter });
    await prisma.teamMember.deleteMany({ where: seedIdFilter });
    await prisma.milestone.deleteMany({ where: seedIdFilter });
    await prisma.application.deleteMany({ where: seedIdFilter });
    await prisma.team.deleteMany({ where: seedIdFilter });
    await prisma.program.deleteMany({ where: seedIdFilter });
    await prisma.consent.deleteMany({
      where: { userId: { startsWith: seedDemoPrefix } },
    });
    await prisma.userProfile.deleteMany({
      where: { userId: { startsWith: seedDemoPrefix } },
    });
    await prisma.user.deleteMany({ where: seedIdFilter });
    for (const storageKey of demoFileStorageKeys) {
      await demoStorage.delete(storageKey);
    }
  }

  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterEach(async () => {
    await deleteDemoSeeded();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    '같은 profile을 두 번 실행해도 seed:demo: 행 수가 그대로고, 수집/랭킹 테이블은 항상 0건이다',
    async () => {
      // Given: 격리된 빈 DB.
      // When: demo profile을 두 번 연속 실행한다.
      const firstRunStats = new SeedStats();
      await runProfile('demo', firstRunStats);
      const countsAfterFirstRun = await countDemoSeeded();

      const secondRunStats = new SeedStats();
      await runProfile('demo', secondRunStats);
      const countsAfterSecondRun = await countDemoSeeded();

      // Then: 각 모델의 seed:demo: 행 수는 두 실행 사이에 변하지 않는다(멱등).
      expect(countsAfterSecondRun).toEqual(countsAfterFirstRun);

      // And: "조용한 no-op"이 아니다 — 프로그램·학생·팀·게시판이 실제로 생긴다.
      expect(countsAfterFirstRun.Program).toBeGreaterThanOrEqual(3);
      expect(countsAfterFirstRun.Program).toBeLessThanOrEqual(4);
      expect(countsAfterFirstRun.User).toBeGreaterThan(0);
      // 에코노베이션 연계 대회 프로그램이 팀 5개(TODO 15 다팀 그래프)를 만들고,
      // 다른 세 프로그램이 각 1개씩 만들어 최소 6팀 이상이다.
      expect(countsAfterFirstRun.Team).toBeGreaterThanOrEqual(6);
      expect(countsAfterFirstRun.Application).toBeGreaterThanOrEqual(6);
      expect(countsAfterFirstRun.Milestone).toBeGreaterThan(0);
      // 대회 프로그램은 팀당 데모데이 제출 1건 + 일부 팀은 최종 발표 제출까지 갖는다.
      expect(countsAfterFirstRun.Submission).toBeGreaterThanOrEqual(9);
      expect(countsAfterFirstRun.SubmissionFile).toBeGreaterThan(0);
      // 승인/보완필요 리뷰가 생기는 제출이 있어 Review도 0건이 아니다(사업단 톤이 실제 검토하는 모습).
      expect(countsAfterFirstRun.Review).toBeGreaterThan(0);
      expect(countsAfterFirstRun.BoardPost).toBeGreaterThan(0);
      expect(countsAfterFirstRun.BoardComment).toBeGreaterThan(0);

      // And: 수집/랭킹 테이블은 이 profile이 결코 쓰지 않는다 — 두 실행 모두 0건.
      expect(countsAfterFirstRun.GithubRepository).toBe(0);
      expect(countsAfterFirstRun.Contribution).toBe(0);
      expect(countsAfterSecondRun.GithubRepository).toBe(0);
      expect(countsAfterSecondRun.Contribution).toBe(0);

      // And: 이름은 합성 한국식 학생이고 실명이 아니며, 이메일은 .invalid만 쓴다.
      const demoUsers = await prisma.user.findMany({
        where: { id: { startsWith: seedDemoPrefix } },
        select: { name: true, notificationEmail: true },
      });
      expect(demoUsers.length).toBeGreaterThan(0);
      for (const user of demoUsers) {
        expect(user.notificationEmail).toMatch(/@demo\.invalid$/);
      }
      expect(demoUsers.some((user) => user.name === '김도윤')).toBe(true);

      // And: 프로그램은 사업단 톤의 합성 이름을 쓴다(실제 공지 문구 미복사).
      const demoPrograms = await prisma.program.findMany({
        where: { id: { startsWith: seedDemoPrefix } },
        select: { name: true, repositoryProvisioningEnabled: true },
      });
      expect(
        demoPrograms.some((program) => program.name.includes('에코노베이션')),
      ).toBe(true);
      for (const program of demoPrograms) {
        // 이 profile은 GithubRepository를 만들지 않으므로 저장소 프로비저닝도 켜지 않는다.
        expect(program.repositoryProvisioningEnabled).toBe(false);
      }

      // And: 모든 시드 SubmissionRevision은 자신이 속한 마일스톤의 submissionType과
      // 동일한 content.type을 쓴다 — submissions.service.ts가
      // content.type !== milestone.submissionType을 CONTENT_TYPE_MISMATCH로 거부하는
      // 도메인 규칙을 시드가 우회하지 않았음을 직접 단언한다.
      const demoRevisions = await prisma.submissionRevision.findMany({
        where: { id: { startsWith: seedDemoPrefix } },
        select: {
          id: true,
          submissionType: true,
          content: true,
          submission: {
            select: { milestone: { select: { submissionType: true } } },
          },
        },
      });
      expect(demoRevisions.length).toBeGreaterThan(0);
      for (const revision of demoRevisions) {
        const milestoneSubmissionType =
          revision.submission.milestone.submissionType;
        expect(revision.submissionType).toBe(milestoneSubmissionType);
        expect((revision.content as { readonly type: string }).type).toBe(
          milestoneSubmissionType,
        );
      }
      // And: FILE 타입 마일스톤(오픈소스 대회 데모데이)은 실제로 FILE content +
      // ATTACHED SubmissionFile이 함께 있는지도 확인한다(시드가 문자열만 맞춰놓고 실제
      // 파일 생명주기는 비워두지 않았는지 검증).
      const fileTypeRevisions = demoRevisions.filter(
        (revision) => revision.submissionType === 'FILE',
      );
      expect(fileTypeRevisions.length).toBeGreaterThan(0);
      for (const revision of fileTypeRevisions) {
        const fileId = (revision.content as { readonly fileId: string }).fileId;
        const submissionFile = await prisma.submissionFile.findUniqueOrThrow({
          where: { id: fileId },
        });
        expect(submissionFile.submissionRevisionId).toBe(revision.id);
        expect(submissionFile.lifecycle).toBe('ATTACHED');
      }

      // And: 대회 프로그램은 팀 5개 이상이 참여하고, 제출 상태가 제출됨(SUBMITTED)·
      // 보완 필요(CHANGES_REQUESTED)·승인(APPROVED) 세 상태 모두로 섞여 있다(TODO 15 —
      // '여러 팀이 참여해 기록이 쌓이는 모습'을 화면에서 보여주기 위한 계약).
      const contestProgramId = seedId(
        'demo',
        'program',
        'oss-developer-contest',
      );
      const contestTeams = await prisma.team.count({
        where: { programId: contestProgramId },
      });
      expect(contestTeams).toBeGreaterThanOrEqual(5);
      const contestApplications = await prisma.application.findMany({
        where: { programId: contestProgramId },
        select: { status: true },
      });
      expect(contestApplications.length).toBeGreaterThanOrEqual(5);
      for (const application of contestApplications) {
        expect(application.status).toBe(ApplicationStatus.APPROVED);
      }
      const contestSubmissionStatuses = await prisma.submission.findMany({
        where: {
          milestone: { programId: contestProgramId },
        },
        select: { status: true },
      });
      const contestStatusSet = new Set(
        contestSubmissionStatuses.map((submission) => submission.status),
      );
      expect(contestStatusSet.has(SubmissionStatus.SUBMITTED)).toBe(true);
      expect(contestStatusSet.has(SubmissionStatus.CHANGES_REQUESTED)).toBe(
        true,
      );
      expect(contestStatusSet.has(SubmissionStatus.APPROVED)).toBe(true);

      // And: 실행 로그가 비어있지 않다(조용한 no-op 아님).
      expect(firstRunStats.report().length).toBeGreaterThan(0);
      expect(secondRunStats.report().length).toBeGreaterThan(0);
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it(
    '보강된 다팀 그래프도 teardown 없이 두 번째 실행에서 멱등하다(팀·지원서·마일스톤 제출 상태 포함)',
    async () => {
      // Given & When: demo profile을 두 번 실행한다(위 테스트와 별도 시나리오로,
      // teardown 전 순수 재실행 경로만 검증한다).
      await runProfile('demo', new SeedStats());
      const firstRun = await countDemoSeeded();
      await runProfile('demo', new SeedStats());
      const secondRun = await countDemoSeeded();

      // Then: 팀·지원서·마일스톤 제출·리뷰까지 전부 행 수가 그대로다.
      expect(secondRun).toEqual(firstRun);
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it(
    '한빛 팀 데모데이 제출은 TODO 11(이미 병합된 구버전) 시점의 보존 id를 유지해 재시드해도 고유 제약을 깨드리지 않는다',
    async () => {
      // Given: TODO 11(이미 병합된 기존 demo profile) 시점의 데이터 모양을 직접 심는다 —
      // 그 시점은 한빛 팀이 유일한 참가팀이었고, 데모데이 제출(FILE)은 팀 접두사 없는
      // `seed:demo:submission:oss-contest-demo-day` id로 만들어졌다(리뷰 없음, SUBMITTED).
      // Program·Milestone·Team·Application·User 부모는 현재 코드와 동일한 id를 쓰므로
      // 정상 profile 실행으로 먼저 만들고, 그 다음 해당 제출만 지우고 예전 shape로 직접
      // 재생성해 '이미 그 id로 시드된 DB'를 재현한다.
      await runProfile('demo', new SeedStats());

      const contestApplicationId = seedId(
        'demo',
        'application',
        'oss-contest-hanbit',
      );
      const contestMilestoneId = seedId(
        'demo',
        'milestone',
        'oss-contest-demo-day',
      );
      const preservedSubmissionId = seedId(
        'demo',
        'submission',
        'oss-contest-demo-day',
      );
      const preservedRevisionId = seedId(
        'demo',
        'submission',
        'oss-contest-demo-day',
        'revision-1',
      );
      const preservedFileId = seedId(
        'demo',
        'submission-file',
        'oss-contest-demo-day',
      );
      const parkHaeunUserId = seedId('demo', 'user', 'park-haeun');

      // 현재 코드는 한빛 팀 데모데이 제출을 APPROVED + Review로 만드므로, 예전(TODO 11)
      // 모양(SUBMITTED, 리뷰 없음)으로 재구성하기 전에 그 Review부터 지우어야 FK 위반이 없다.
      await prisma.review.deleteMany({
        where: { submissionRevisionId: preservedRevisionId },
      });
      await prisma.submissionFile.deleteMany({
        where: { id: preservedFileId },
      });
      await prisma.submissionRevision.deleteMany({
        where: { id: preservedRevisionId },
      });
      await prisma.submission.deleteMany({
        where: { id: preservedSubmissionId },
      });
      await prisma.submission.create({
        data: {
          id: preservedSubmissionId,
          milestoneId: contestMilestoneId,
          applicationId: contestApplicationId,
          status: SubmissionStatus.SUBMITTED,
          currentRevision: 1,
        },
      });
      await prisma.submissionRevision.create({
        data: {
          id: preservedRevisionId,
          submissionId: preservedSubmissionId,
          revision: 1,
          submissionType: MilestoneSubmissionType.FILE,
          content: {
            type: MilestoneSubmissionType.FILE,
            fileId: preservedFileId,
          },
          submittedById: parkHaeunUserId,
        },
      });
      await prisma.submissionFile.create({
        data: {
          id: preservedFileId,
          uploaderId: parkHaeunUserId,
          applicationId: contestApplicationId,
          milestoneId: contestMilestoneId,
          submissionRevisionId: preservedRevisionId,
          storageKey: `demo/${preservedFileId}`,
          originalFileName: 'oss-contest-demo-day-draft.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1_048_576,
          lifecycle: 'ATTACHED',
        },
      });

      // When: 현재 코드의 demo profile을 다시 실행한다 — 한빛 팀의 데모데이 제출을
      // 팀 접두사가 붙은 새 id(`oss-contest-hanbit-demo-day`)로 만들려하면, 위에서 심은
      // 예전 id 행과 같은 (applicationId, milestoneId) 쌍을 가지므로
      // `Submission_applicationId_milestoneId_key` 고유 제약 위반으로 예외가 던져야 한다.
      await expect(runProfile('demo', new SeedStats())).resolves.not.toThrow();

      // Then: (applicationId, milestoneId) 쌍에 제출이 정확히 1건이고, 그 id는 여전히
      // 보존 id다(현재 코드가 이 id를 재사용해 upsert했다는 증거 — 새 id로 중복 행을
      // 만들지 않았다).
      const submissionsForPair = await prisma.submission.findMany({
        where: {
          applicationId: contestApplicationId,
          milestoneId: contestMilestoneId,
        },
      });
      expect(submissionsForPair).toHaveLength(1);
      expect(submissionsForPair[0]?.id).toBe(preservedSubmissionId);

      // And: 보존 id의 SubmissionRevision·SubmissionFile도 그대로 재사용된다(새 id로
      // 따로 만들어지지 않음).
      const [preservedRevision, preservedFile, teamSuffixedSubmission] =
        await Promise.all([
          prisma.submissionRevision.findUnique({
            where: { id: preservedRevisionId },
          }),
          prisma.submissionFile.findUnique({ where: { id: preservedFileId } }),
          prisma.submission.findUnique({
            where: {
              id: seedId('demo', 'submission', 'oss-contest-hanbit-demo-day'),
            },
          }),
        ]);
      expect(preservedRevision).not.toBeNull();
      expect(preservedFile).not.toBeNull();
      expect(teamSuffixedSubmission).toBeNull();
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it(
    'teardown은 시드 후 모든 demo-touched 테이블에서 seed:demo: 행을 0건으로 만든다',
    async () => {
      // Given: demo profile을 시드해 다팀 그래프·게시판까지 전부 채운다.
      await runProfile('demo', new SeedStats());
      const countsBeforeTeardown = await countDemoSeeded();
      expect(countsBeforeTeardown.User).toBeGreaterThan(0);
      expect(countsBeforeTeardown.Program).toBeGreaterThan(0);
      expect(countsBeforeTeardown.Team).toBeGreaterThan(0);
      expect(countsBeforeTeardown.Submission).toBeGreaterThan(0);
      expect(countsBeforeTeardown.Review).toBeGreaterThan(0);

      // When: teardown을 실행한다(이 테스트 자체가 afterEach의 deleteDemoSeeded와
      // 별개로 teardownDemo 구현을 직접 검증한다 — afterEach는 이후에도 안전하게 no-op).
      await runTeardown('demo', new SeedStats());

      // Then: seed:demo: 접두사를 가진 모든 테이블(GithubRepository·Contribution포함)이 0건이다.
      const countsAfterTeardown = await countDemoSeeded();
      for (const count of Object.values(countsAfterTeardown)) {
        expect(count).toBe(0);
      }
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it(
    'teardown은 seed:demo: 접두사가 아닌 비-demo 행을 절대 건드리지 않는다',
    async () => {
      // Given: demo profile을 시드하고, seed:demo: 접두사가 아닌 별도 비-demo fixture
      // 행(User→Program→Team→TeamMember→Application)을 직접 심는다 — teardown 대상
      // 밖의 데이터가 살아남는지 증명하는 목적의 최소 그래프다.
      await runProfile('demo', new SeedStats());

      const survivorUserId = 'seed:demo-teardown-guard:user';
      const survivorProgramId = 'seed:demo-teardown-guard:program';
      const survivorTeamId = 'seed:demo-teardown-guard:team';
      const survivorApplicationId = 'seed:demo-teardown-guard:application';

      await prisma.user.create({
        data: {
          id: survivorUserId,
          githubId: seedGithubId(survivorUserId),
          nickname: 'demo-teardown-guard',
          selectedMemberKind: MemberKind.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
        },
      });
      await prisma.program.create({
        data: {
          id: survivorProgramId,
          name: 'teardown guard 비-demo 프로그램(fixture)',
          organizer: 'teardown guard fixture',
          category: ProgramCategory.BASIC,
          applicationTemplateKey: 'basic',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2020-01-01T00:00:00Z'),
          applicationEndAt: new Date('2020-01-02T00:00:00Z'),
          description:
            'teardown이 절대 지우면 안 되는 비-demo 프로그램(fixture).',
        },
      });
      await prisma.team.create({
        data: {
          id: survivorTeamId,
          programId: survivorProgramId,
          name: 'teardown guard 팀',
          joinCodeDigest: computeJoinCodeDigest(
            `TEARDOWN-GUARD-${survivorTeamId}`,
          ),
          leaderId: survivorUserId,
        },
      });
      await prisma.teamMember.create({
        data: {
          id: 'seed:demo-teardown-guard:team-member',
          teamId: survivorTeamId,
          programId: survivorProgramId,
          userId: survivorUserId,
        },
      });
      await prisma.application.create({
        data: {
          id: survivorApplicationId,
          programId: survivorProgramId,
          applicantId: survivorUserId,
          teamId: survivorTeamId,
          answers: { seedPlaceholder: true, scenarioId: 'teardown-guard' },
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
        },
      });

      try {
        // When: demo profile teardown을 실행한다.
        await runTeardown('demo', new SeedStats());

        // Then: seed:demo: 접두사 데모 데이터는 모두 사라졌지만,
        const demoCountsAfterTeardown = await countDemoSeeded();
        for (const count of Object.values(demoCountsAfterTeardown)) {
          expect(count).toBe(0);
        }

        // And: seed:demo-teardown-guard: 접두사(비-demo) 행은 그대로 살아남는다.
        const [
          survivorUser,
          survivorProgram,
          survivorTeam,
          survivorApplication,
        ] = await Promise.all([
          prisma.user.findUnique({ where: { id: survivorUserId } }),
          prisma.program.findUnique({ where: { id: survivorProgramId } }),
          prisma.team.findUnique({ where: { id: survivorTeamId } }),
          prisma.application.findUnique({
            where: { id: survivorApplicationId },
          }),
        ]);
        expect(survivorUser).not.toBeNull();
        expect(survivorProgram).not.toBeNull();
        expect(survivorTeam).not.toBeNull();
        expect(survivorApplication).not.toBeNull();
      } finally {
        // Cleanup: 이 테스트가 심은 비-demo fixture는 afterEach의 deleteDemoSeeded가
        // (접두사가 다르므로) 지우지 않는다 — 직접 정리한다.
        await prisma.application.deleteMany({
          where: { id: survivorApplicationId },
        });
        await prisma.teamMember.deleteMany({
          where: { teamId: survivorTeamId },
        });
        await prisma.team.deleteMany({ where: { id: survivorTeamId } });
        await prisma.program.deleteMany({ where: { id: survivorProgramId } });
        await prisma.user.deleteMany({ where: { id: survivorUserId } });
      }
    },
    SEED_RUN_TIMEOUT_MS,
  );

  /**
   * #910/#913 파인딩 4 — ATTACHED SubmissionFile은 실제 검색 가능한 storage 객체를
   * 동반해야 하고, 그 key는 reconciliation CLI 소유 prefix 안에 있어야 하며,
   * 재시드는 객체를 중복으로 만들지 않고(멱등), teardown은 DB row와 객체를 둘 다
   * 지운다.
   */
  it(
    'ATTACHED SubmissionFile은 reconciliation 소유 prefix 아래의 실제 검색 가능한 객체를 가진다',
    async () => {
      // Given & When: demo profile을 실행한다.
      await runProfile('demo', new SeedStats());

      // Then: ATTACHED인 모든 SubmissionFile이 실제 객체를 가진다 — 404가 아니라
      // 응답받을 수 있고, key는 reconciliation CLI가 인벤토리하는 prefix에 속한다.
      const demoFiles = await prisma.submissionFile.findMany({
        where: { id: { startsWith: seedDemoPrefix } },
        select: { id: true, storageKey: true, lifecycle: true },
      });
      expect(demoFiles.length).toBeGreaterThan(0);
      for (const file of demoFiles) {
        expect(file.lifecycle).toBe('ATTACHED');
        expect(
          KNOWN_STORAGE_PREFIXES.some((prefix) =>
            file.storageKey.startsWith(prefix),
          ),
        ).toBe(true);
        await expect(demoStorageObjectExists(file.storageKey)).resolves.toBe(
          true,
        );
        // 실제 get()으로도 검색할 수 있어야 한다(단순 HEAD가 아니라 실제 바이너리 본문 조회).
        const body = await demoStorage.get(file.storageKey);
        const chunks: Buffer[] = [];
        for await (const chunk of body as AsyncIterable<Buffer>) {
          chunks.push(chunk);
        }
        expect(Buffer.concat(chunks).byteLength).toBeGreaterThan(0);
      }
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it(
    'demo profile을 두 번 실행해도 같은 storage 객체 key만 남고 새 객체가 늘지 않는다(멱등)',
    async () => {
      // Given & When: demo profile을 두 번 연속 실행한다.
      await runProfile('demo', new SeedStats());
      const firstRunFiles = await prisma.submissionFile.findMany({
        where: { id: { startsWith: seedDemoPrefix } },
        select: { storageKey: true },
        orderBy: { id: 'asc' },
      });
      await runProfile('demo', new SeedStats());
      const secondRunFiles = await prisma.submissionFile.findMany({
        where: { id: { startsWith: seedDemoPrefix } },
        select: { storageKey: true },
        orderBy: { id: 'asc' },
      });

      // Then: 같은 key 집합이고, 두 실행 뒤에도 각 객체가 여전히 실제로 존재한다.
      expect(secondRunFiles).toEqual(firstRunFiles);
      for (const file of secondRunFiles) {
        await expect(demoStorageObjectExists(file.storageKey)).resolves.toBe(
          true,
        );
      }
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it(
    'teardown은 자신이 만든 storage 객체를 모두 지우고, 비-demo 객체는 건드리지 않는다',
    async () => {
      // Given: demo profile을 시드해 실제 storage 객체까지 만든다.
      await runProfile('demo', new SeedStats());
      const demoFiles = await prisma.submissionFile.findMany({
        where: { id: { startsWith: seedDemoPrefix } },
        select: { storageKey: true },
      });
      expect(demoFiles.length).toBeGreaterThan(0);

      // And: teardown 대상이 아닌 비-demo 객체를 하나 별도로 심는다(reconciliation 소유
      // prefix 안이지만 seed-demo 하위 네임스페이스 밖).
      const survivorKey = `submission-files/seed-demo-teardown-guard-${Date.now()}`;
      await demoStorage.put({
        objectKey: survivorKey,
        originalName: 'survivor.txt',
        contentType: 'text/plain',
        body: Buffer.from('teardown이 지우면 안 되는 비-demo 객체(fixture)'),
      });

      try {
        // When: teardown을 실행한다.
        await runTeardown('demo', new SeedStats());

        // Then: demo profile이 만든 모든 storage 객체가 사라졌다.
        for (const file of demoFiles) {
          await expect(demoStorageObjectExists(file.storageKey)).resolves.toBe(
            false,
          );
        }
        // And: 비-demo 객체는 살아남는다.
        await expect(demoStorageObjectExists(survivorKey)).resolves.toBe(true);
      } finally {
        await demoStorage.delete(survivorKey);
      }
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it('production에서는 SEED_DEMO_ALLOW_PRODUCTION=1 없이 거부된다', () => {
    // Given & When & Then: DB 쓰기 전에 거부해야 한다 — assertSeedAllowed 자체를 직접 호출해
    // 실제 seed 실행(격리 DB에도 영향을 주는) 없이 게이트 로직만 검증한다.
    const { assertSeedAllowed } =
      jest.requireActual<typeof import('./seeds/helpers')>('./seeds/helpers');
    expect(() => assertSeedAllowed('production', 'demo', undefined)).toThrow(
      /SEED_DEMO_ALLOW_PRODUCTION/,
    );
    expect(() => assertSeedAllowed('production', 'demo', '0')).toThrow(
      /SEED_DEMO_ALLOW_PRODUCTION/,
    );
  });

  it('production + SEED_DEMO_ALLOW_PRODUCTION=1 조합은 demo profile을 허용한다', () => {
    const { assertSeedAllowed } =
      jest.requireActual<typeof import('./seeds/helpers')>('./seeds/helpers');
    expect(() => assertSeedAllowed('production', 'demo', '1')).not.toThrow();
  });

  it('production에서는 demo 외 다른 모든 profile이 플래그와 무관하게 거부된다', () => {
    const { assertSeedAllowed } =
      jest.requireActual<typeof import('./seeds/helpers')>('./seeds/helpers');
    expect(() => assertSeedAllowed('production', 'auth', '1')).toThrow(
      /production/,
    );
    expect(() => assertSeedAllowed('production', 'all', '1')).toThrow(
      /production/,
    );
  });
});

/**
 * #910/#913 파인딩 3 — production에서 demo profile을 돌리면 seed.ts가 post-seed
 * user-profile backfill을 호출하며(seed.ts:63-66), 이 경로의 backfill은 그 예외가
 * 만든 seed:demo:* 행만 만져야 한다. 이미 존재하는 비-demo production 사용자의
 * legacy 프로필 불일치(PROFILE_MISMATCH)가 demo 시드 실행을 실패시키거나 그 사용자의
 * 프로필을 쓰지 않아야 한다(실제 production 장애 재현).
 */
describe('seed profile=demo production 백필 스코프 (integration)', () => {
  const seedDemoPrefix = 'seed:demo:';
  const nonDemoUserId = 'test:profile-backfill-scope:non-demo-oauth-user';
  const originalNodeEnv = process.env.NODE_ENV;

  async function deleteDemoSeeded(): Promise<void> {
    const seedIdFilter = { id: { startsWith: seedDemoPrefix } } as const;
    // 이 describe도 runProfile('demo', ...)로 실제 storage 객체를 만든다(#910/#913
    // 파인딩 4) — DB row를 지우기 전에 storageKey를 읽어 같이 정리해야 같은 Jest 프로세스
    // 내 다른 integration spec(reconciliation 등)으로 새어나가지 않는다.
    const demoFileStorageKeys = (
      await prisma.submissionFile.findMany({
        where: seedIdFilter,
        select: { storageKey: true },
      })
    ).map((file) => file.storageKey);
    await prisma.review.deleteMany({ where: seedIdFilter });
    await prisma.submissionFile.deleteMany({ where: seedIdFilter });
    await prisma.submissionRevision.deleteMany({ where: seedIdFilter });
    await prisma.submission.deleteMany({ where: seedIdFilter });
    await prisma.boardComment.deleteMany({ where: seedIdFilter });
    await prisma.boardPost.deleteMany({ where: seedIdFilter });
    await prisma.teamMember.deleteMany({ where: seedIdFilter });
    await prisma.milestone.deleteMany({ where: seedIdFilter });
    await prisma.application.deleteMany({ where: seedIdFilter });
    await prisma.team.deleteMany({ where: seedIdFilter });
    await prisma.program.deleteMany({ where: seedIdFilter });
    await prisma.consent.deleteMany({
      where: { userId: { startsWith: seedDemoPrefix } },
    });
    await prisma.userProfile.deleteMany({
      where: { userId: { startsWith: seedDemoPrefix } },
    });
    await prisma.user.deleteMany({ where: seedIdFilter });
    for (const storageKey of demoFileStorageKeys) {
      await demoStorage.delete(storageKey);
    }
  }

  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.SEED_DEMO_ALLOW_PRODUCTION;
    await deleteDemoSeeded();
    await prisma.userProfile.deleteMany({ where: { userId: nonDemoUserId } });
    await prisma.user.deleteMany({ where: { id: nonDemoUserId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    'production demo 시드는 이미 존재하는 비-demo PROFILE_MISMATCH 사용자를 건드리지 않고, 그것 때문에 실패하지도 않는다',
    async () => {
      // Given: 이미 production에 존재하는 비-demo 사용자(수동 교정된 OAuth 계정)가
      // legacy User 컴럼이 완료 프로필 모양이면서 UserProfile과 값이 어긋나는
      // PROFILE_MISMATCH 상태를 직접 심는다 — 실제 production에서 이 오류로 시드 CLI가
      // 비정상 종료했던 사례를 재현한다.
      const completeStudentId = ['96', '5501'].join('');
      await prisma.user.create({
        data: {
          id: nonDemoUserId,
          githubId: seedGithubId(nonDemoUserId),
          nickname: 'profile-backfill-scope-non-demo',
          selectedMemberKind: MemberKind.STUDENT,
          profile: {
            create: {
              name: '비-demo 생산 사용자(fixture)',
              studentId: completeStudentId,
              department: '비-demo 학과(fixture)',
              memberKind: MemberKind.STUDENT,
              affiliationKind: AffiliationKind.DEPARTMENT,
              affiliationName: '비-demo 학과(fixture)',
            },
          },
        },
      });
      await prisma.userProfile.create({
        data: {
          userId: nonDemoUserId,
          name: '불일치하는 이름(fixture)',
          studentId: completeStudentId,
          department: '불일치하는 학과(fixture)',
        },
      });
      const nonDemoUserBefore = await prisma.user.findUniqueOrThrow({
        where: { id: nonDemoUserId },
      });
      const nonDemoProfileBefore = await prisma.userProfile.findUniqueOrThrow({
        where: { userId: nonDemoUserId },
      });

      // 사전 조건: 이 불일치가 실제로 전체 backfill을 실패시킨다는 것을 먼저 확인한다
      // (스코프 없는 기존 동작 그대로).
      await expect(backfillUserProfiles(prisma)).rejects.toMatchObject({
        kind: USER_PROFILE_BACKFILL_ERROR_KIND.PROFILE_MISMATCH,
        userIds: [nonDemoUserId],
      });

      // When: production + SEED_DEMO_ALLOW_PRODUCTION=1로 demo profile을 실행한다 —
      // 실제 seed.ts의 production 예외 경로를 그대로 타고(assertSeedAllowed 통과 후
      // runProfile이 seedDemo + 스코프된 backfillUserProfiles를 호출).
      process.env.NODE_ENV = 'production';
      process.env.SEED_DEMO_ALLOW_PRODUCTION = '1';
      const { assertSeedAllowed } =
        jest.requireActual<typeof import('./seeds/helpers')>('./seeds/helpers');
      assertSeedAllowed(process.env.NODE_ENV, 'demo');
      await expect(runProfile('demo', new SeedStats())).resolves.not.toThrow();

      // Then: 비-demo 사용자의 User/UserProfile은 전혀 쓰이지 않았다 — 이미
      // 존재하는 불일치를 그대로 보존한다.
      const nonDemoUserAfter = await prisma.user.findUniqueOrThrow({
        where: { id: nonDemoUserId },
      });
      const nonDemoProfileAfter = await prisma.userProfile.findUniqueOrThrow({
        where: { userId: nonDemoUserId },
      });
      expect(nonDemoUserAfter).toEqual(nonDemoUserBefore);
      expect(nonDemoProfileAfter).toEqual(nonDemoProfileBefore);

      // And: demo 자체는 정상적으로 시드되었다(실패하지 않았고, 그 사용자들은 실제로
      // 프로필이 백필되었다).
      const demoUserCount = await prisma.user.count({
        where: { id: { startsWith: seedDemoPrefix } },
      });
      expect(demoUserCount).toBeGreaterThan(0);
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it(
    '비-production demo 시드는 기존과 동일하게 전체 User를 대상으로 backfill한다(스코프 없음)',
    async () => {
      // Given: 비-demo 사용자의 불완전 legacy 프로필(EXPECTED_INCOMPLETE, profile 미생성)를
      // 심는다 — production이 아니면 이 사용자도 전체 backfill 대상이어야 한다.
      await prisma.user.create({
        data: {
          id: nonDemoUserId,
          githubId: seedGithubId(nonDemoUserId),
          nickname: 'profile-backfill-scope-non-demo-dev',
          selectedMemberKind: MemberKind.STUDENT,
          profile: {
            create: {
              name: '비-demo 개발 사용자(fixture)',
              studentId: null,
              department: '비-demo 학과(fixture)',
              memberKind: MemberKind.STUDENT,
              affiliationKind: AffiliationKind.DEPARTMENT,
              affiliationName: '비-demo 학과(fixture)',
            },
          },
          studentId: ['96', '5502'].join(''),
        },
      });

      // When: NODE_ENV가 production이 아닌 채 demo profile을 실행한다(기본 경로).
      expect(process.env.NODE_ENV).not.toBe('production');
      await runProfile('demo', new SeedStats());

      // Then: 비-demo 사용자도 전체 backfill 대상에 들어 UserProfile이 생성된다 —
      // production 외에서는 기존 거동(전체 backfill)이 그대로 유지된다.
      const nonDemoProfile = await prisma.userProfile.findUnique({
        where: { userId: nonDemoUserId },
      });
      expect(nonDemoProfile).not.toBeNull();
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
        role: 'STAFF',
        accountStatus: AccountStatus.DEACTIVATED,
      });
    },
    SEED_RUN_TIMEOUT_MS,
  );
});

/**
 * #184 관리자 승인·거절·회수 e2e가 쓸 페르소나의 계약.
 *
 * 판정을 이 파일에서 다시 계산하지 않고 **실제 로그인 경로**(`AuthRepository.findByGithubId`
 * → `toDomain` → `isCompleteProfileFields`)로 확인한다. 세션이 실어 보내는 그 값이 곧
 * `role-gate.tsx`가 화면을 열지 말지 정하는 근거라서, 이름이 채워졌는지만 보면 게이트가
 * 실제로 열리는지는 여전히 모른다.
 */
describe('#184 관리자 e2e 페르소나 (integration)', () => {
  const authPrisma = new PrismaService();
  // findByGithubId는 초기 역할 시드를 쓰지 않는다(upsertUser 경로 전용).
  const authRepository = new AuthRepository(authPrisma, {
    resolveInitialRole: () => null,
  } as unknown as AuthConfig);

  beforeAll(async () => {
    await prisma.$connect();
    await authPrisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterAll(async () => {
    await authPrisma.$disconnect();
    await prisma.$disconnect();
  });

  it(
    '관리자 두 명은 실제 로그인 경로에서 프로필 완료로 판정된다',
    async () => {
      // Given & When: auth profile을 두 번 실행한다(멱등 무회귀도 같이 본다).
      await runProfile('auth', new SeedStats());
      await runProfile('auth', new SeedStats());

      // Then: 세션이 싣는 값 자체가 완료여야 관리자 화면이 열린다.
      const [admin, adminSecond] = await Promise.all([
        authRepository.findByGithubId(seedGithubId(adminConfirmedUserId)),
        authRepository.findByGithubId(seedGithubId(adminSecondUserId)),
      ]);

      expect(admin?.id).toBe(adminConfirmedUserId);
      expect(admin?.role).toBe('ADMIN');
      expect(admin?.accountStatus).toBe(AccountStatus.ACTIVE);
      expect(admin?.isProfileComplete).toBe(true);

      expect(adminSecond?.id).toBe(adminSecondUserId);
      expect(adminSecond?.role).toBe('ADMIN');
      expect(adminSecond?.accountStatus).toBe(AccountStatus.ACTIVE);
      expect(adminSecond?.isProfileComplete).toBe(true);

      // 결정 이력의 `decidedBy`가 두 사람을 구분하려면 이름이 서로 달라야 한다.
      const [adminRow, adminSecondRow] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: adminConfirmedUserId } }),
        prisma.user.findUniqueOrThrow({ where: { id: adminSecondUserId } }),
      ]);
      expect(adminRow.name).toBe('합성 관리자');
      expect(adminSecondRow.name).toBe('합성 두 번째 관리자');

      // ADMIN은 학번·학과를 요구하지 않는다 — 학과만 채우면 backfill이 거부한다.
      expect(adminRow.studentId).toBeNull();
      expect(adminRow.department).toBeNull();
      const adminProfileRowCount = await prisma.userProfile.count({
        where: { userId: { in: [adminConfirmedUserId, adminSecondUserId] } },
      });
      expect(adminProfileRowCount).toBe(0);
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it(
    'staff-revocable은 회수를 누를 수 있는 ACTIVE·STAFF·승인 완료 상태다',
    async () => {
      // Given & When
      await runProfile('auth', new SeedStats());

      // Then: 로그인이 되고(ACTIVE) 화면이 열려야(프로필 완료) 회수 직후 화면을 볼 수 있다.
      const revocable = await authRepository.findByGithubId(
        seedGithubId(staffRevocableUserId),
      );
      expect(revocable?.id).toBe(staffRevocableUserId);
      expect(revocable?.role).toBe('STAFF');
      expect(revocable?.accountStatus).toBe(AccountStatus.ACTIVE);
      expect(revocable?.isProfileComplete).toBe(true);

      // And: 회수의 출발점인 APPROVED 요청이 정확히 하나 있고 REVOKED 행은 아직 없다.
      const requests = await prisma.staffAccessRequest.findMany({
        where: { userId: staffRevocableUserId },
        orderBy: { createdAt: 'asc' },
      });
      expect(requests.length).toBe(1);
      expect(requests[0]?.status).toBe(StaffAccessRequestStatus.APPROVED);
      expect(requests[0]?.decidedById).toBe(adminConfirmedUserId);

      // And: 기존 회수 페르소나는 그대로다 — 로그인 자체가 막히는 상태를 쓰는
      // 다른 시나리오가 그것에 기대고 있다(#187, #188).
      const revoked = await prisma.user.findUniqueOrThrow({
        where: { id: staffRevokedUserId },
      });
      expect(revoked.accountStatus).toBe(AccountStatus.DEACTIVATED);
      expect(revoked.role).toBe('STAFF');
    },
    SEED_RUN_TIMEOUT_MS,
  );
});
