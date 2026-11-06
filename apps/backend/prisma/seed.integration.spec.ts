import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  AccountStatus,
  DepartmentType,
  ApplicationStatus,
  UserType,
  SubmissionHistoryEvent,
  MilestoneSubmissionType,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  ReviewDecision,
  ApprovalStatus,
  SubmissionStatus,
} from '@prisma/client';
import { runProfile, runTeardown } from './seed';
import { AUTH_SCENARIOS } from './seeds/auth';
import { prisma, seedGithubId, seedId, SeedStats } from './seeds/helpers';
import { upsertSeedUser } from './seeds/user';
import {
  AuthRepository,
  type AuthUserRecord,
} from '../src/auth/auth.repository';
import { AdminAccessHistoryRepository } from '../src/users/admin-access-history.repository';
import { PrismaService } from '../src/platform/prisma.service';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3ObjectStorageClient } from '../src/platform/s3-object-storage.client';
import { ObjectStorageConfig } from '../src/platform/object-storage.config';
import { CONSENT_POLICY_VERSION } from '../src/users/consents.service';
import { KNOWN_STORAGE_PREFIXES } from '../src/programs/file-cleanup.service';
import { UserProfileService } from '../src/users/user-profile.service';
import { RepositoryUrlService } from '../src/github/repository-url.service';

const repositoryUrlService = new RepositoryUrlService();
function isProfileComplete(user: AuthUserRecord | null): boolean {
  return (
    user !== null &&
    new UserProfileService().isCompleteProfileFields(
      {
        name: user.name,
        studentId: user.studentId,
        department: user.department,
      },
      user.memberKind ?? user.selectedMemberKind,
    )
  );
}
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const DATABASE_CONNECTION_TIMEOUT_MS = 60000;
const demoStorageConfig = new ObjectStorageConfig();
const demoStorage = new S3ObjectStorageClient(demoStorageConfig);
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
    const status = (
      error as {
        $metadata?: {
          httpStatusCode?: number;
        };
      }
    ).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw error;
  }
}
const SEED_RUN_TIMEOUT_MS = 60000;
const ISSUE99_OLDER_POLICY_VERSION = '2025-12';
const consentRequiredUserId = AUTH_SCENARIOS['consent-required'];
const roleUnselectedUserId = AUTH_SCENARIOS['user-role-unselected'];
const profileCompleteUserId = AUTH_SCENARIOS['profile-complete'];
const staffPendingUserId = AUTH_SCENARIOS['staff-pending'];
const staffPendingSecondUserId = AUTH_SCENARIOS['staff-pending-second'];
const staffRejectedUserId = AUTH_SCENARIOS['staff-rejected'];
const staffRevokedUserId = AUTH_SCENARIOS['staff-revoked'];
const staffRevocableUserId = AUTH_SCENARIOS['staff-revocable'];
const adminConfirmedUserId = AUTH_SCENARIOS['admin-confirmed'];
const adminSecondUserId = AUTH_SCENARIOS['admin-second'];
const OSS_HUB_TEAM_ACCOUNTS = [
  '9800000000000001:seed-operator-alpha:ADMIN:시드운영자알파',
  '9800000000000002:seed-operator-beta:ADMIN:시드운영자베타',
  '9800000000000003:seed-operator-gamma:ADMIN:시드운영자감마',
  '9800000000000004:seed-operator-delta:ADMIN:시드운영자델타',
].join(',');
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
const OSS_HUB_REPOSITORY_ID = seedId('oss-hub', 'repository');
const OSS_HUB_PROVISION_JOB_ID = seedId('oss-hub', 'provision-job');
const OSS_HUB_REPOSITORY_URL = 'https://github.com/JNU-SWCU/oss-hub';

const OSS_HUB_GITHUB_REPOSITORY_ID = 1297138137n;
const OSS_HUB_PRACTICE_PROGRAM_ID = seedId('oss-hub-practice', 'program');
const OSS_HUB_PRACTICE_TEAM_ID = seedId('oss-hub-practice', 'team');
const OSS_HUB_PRACTICE_REPOSITORY_ID = seedId('oss-hub-practice', 'repository');
const OSS_HUB_PRACTICE_PROVISION_JOB_ID = seedId(
  'oss-hub-practice',
  'provision-job',
);
const OSS_HUB_PRACTICE_REPOSITORY_URL =
  'https://github.com/JNU-SWCU/oss-hub-practice';

const OSS_HUB_PRACTICE_GITHUB_REPOSITORY_ID = 1296567792n;
const OSS_HUB_NOTICE_EXAMPLES = [
  '[모집홍보] 2026 오픈소스 개발자대회 모집 안내',
  '｢모집홍보｣ 『LLMOps 파이프라인 개발』 교육 2026학년 2학기 자유학기(자유교과목) 신청 안내',
  'https://sojoong.kr/notice/notice-board/?mod=document&uid=922',
  'https://sojoong.kr/notice/notice-board/?mod=document&uid=939',
] as const;
const SEEDED_MODEL_COUNTERS: ReadonlyArray<
  [name: string, count: () => Promise<number>]
> = [
  ['User', () => prisma.user.count({ where: { id: { startsWith: 'seed:' } } })],
  [
    'Admin',
    () => prisma.admin.count({ where: { userId: { startsWith: 'seed:' } } }),
  ],
  [
    'User.profile',
    () =>
      prisma.user.count({
        where: { id: { startsWith: 'seed:' }, profileCreatedAt: { not: null } },
      }),
  ],
  [
    'ApprovalRequest',
    async () =>
      (
        await prisma.userHistory.findMany({
          where: {
            userId: { startsWith: 'seed:' },
            sourceTable: 'SeedRequest',
          },
          distinct: ['sourceId'],
          select: { sourceId: true },
        })
      ).length,
  ],
  [
    'UserPolicy',
    () =>
      prisma.userPolicy.count({ where: { userId: { startsWith: 'seed:' } } }),
  ],
  [
    'Program',
    () => prisma.program.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  [
    'Milestone',
    () => prisma.milestone.count({ where: { id: { startsWith: 'seed:' } } }),
  ],
  ['Team', () => prisma.team.count({ where: { id: { startsWith: 'seed:' } } })],
  [
    'TeamMember',
    () =>
      prisma.teamMember.count({ where: { teamId: { startsWith: 'seed:' } } }),
  ],
  [
    'MilestoneDocumentSubmission',
    () =>
      prisma.submission.count({
        where: { id: { startsWith: 'seed:' } },
      }),
  ],
  [
    'MilestoneDocumentSubmissionHistory',
    () =>
      prisma.submissionHistory.count({
        where: { id: { startsWith: 'seed:' } },
      }),
  ],
  [
    'SubmissionFile',
    () =>
      prisma.file.count({
        where: { kind: 'SUBMISSION', id: { startsWith: 'seed:' } },
      }),
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
      prisma.requirement.count({
        where: { id: { startsWith: 'seed:' } },
      }),
  ],
  [
    'MilestoneDocumentTemplateFile',
    () =>
      prisma.file.count({
        where: { kind: 'TEMPLATE', id: { startsWith: 'seed:' } },
      }),
  ],
  [
    'MilestoneDocumentSubmission',
    () =>
      prisma.submission.count({
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
async function deleteAllSeeded(): Promise<void> {
  const seedPrefix = 'seed:';
  const seedIdFilter = { id: { startsWith: seedPrefix } } as const;
  await prisma.file.deleteMany({
    where: { kind: 'SUBMISSION', submissionId: { startsWith: seedPrefix } },
  });
  await prisma.submissionHistory.deleteMany({
    where: {
      submissionId: { startsWith: seedPrefix },
    },
  });
  const [
    submissionFilesByTeam,
    submissionFilesByMilestone,
    notificationUsers,
    loginHistoryUsers,
    submissionFileUploaders,
    historyUsers,
  ] = await Promise.all([
    prisma.file.findMany({
      where: { kind: 'SUBMISSION', teamId: { startsWith: seedPrefix } },
      select: { teamId: true },
      distinct: ['teamId'],
    }),
    prisma.milestone.findMany({
      where: {
        id: { startsWith: seedPrefix },
        requirements: { some: { files: { some: { kind: 'SUBMISSION' } } } },
      },
      select: { id: true },
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
    prisma.file.findMany({
      where: { kind: 'SUBMISSION', uploaderId: { startsWith: seedPrefix } },
      select: { uploaderId: true },
      distinct: ['uploaderId'],
    }),
    prisma.user.findMany({
      where: {
        id: { startsWith: seedPrefix },
        OR: [
          { userHistories: { some: {} } },
          { actedUserHistories: { some: {} } },
          { adminHistories: { some: {} } },
          { actedAdminHistories: { some: {} } },
          { admin: { isNot: null } },
          { adminGrants: { some: {} } },
          { approvalDecisions: { some: {} } },
        ],
      },
      select: { id: true },
    }),
  ]);

  const protectedTeamIds = new Set(
    submissionFilesByTeam
      .map((row) => row.teamId)
      .filter((id): id is string => id !== null),
  );
  const protectedMilestoneIds = new Set(
    submissionFilesByMilestone
      .map((row) => row.id)
      .filter((id): id is string => id !== null),
  );
  const protectedUserIds = new Set([
    ...notificationUsers.map((row) => row.userId),
    ...loginHistoryUsers.map((row) => row.userId),
    ...submissionFileUploaders
      .map((row) => row.uploaderId)
      .filter((id): id is string => id !== null),
    ...historyUsers.map((row) => row.id),
  ]);
  const excluding = (protectedIds: Set<string>) =>
    protectedIds.size > 0 ? { NOT: { id: { in: [...protectedIds] } } } : {};
  await prisma.repositoryProvisionJob.deleteMany({ where: seedIdFilter });
  await prisma.repositoryInvitation.deleteMany({ where: seedIdFilter });
  await prisma.outboxEvent.deleteMany({ where: seedIdFilter });
  await prisma.githubRepository.deleteMany({ where: seedIdFilter });
  await prisma.submission.deleteMany({ where: seedIdFilter });
  await prisma.file.deleteMany({ where: seedIdFilter });
  await prisma.requirement.deleteMany({ where: seedIdFilter });
  await prisma.boardComment.deleteMany({ where: seedIdFilter });
  await prisma.boardPost.deleteMany({ where: seedIdFilter });
  await prisma.teamInvitation.deleteMany({ where: seedIdFilter });
  await prisma.teamMember.deleteMany({ where: { teamId: seedIdFilter.id } });
  await prisma.milestone.deleteMany({
    where: { ...seedIdFilter, ...excluding(protectedMilestoneIds) },
  });
  await prisma.team.deleteMany({
    where: { ...seedIdFilter, ...excluding(protectedTeamIds) },
  });
  await prisma.program.deleteMany({ where: seedIdFilter });
  await prisma.userPolicy.deleteMany({
    where: { userId: { startsWith: seedPrefix } },
  });
  await prisma.admin.deleteMany({
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
    delete process.env.OSS_HUB_SEED_CONFIRMATION;

    await expect(runProfile('oss-hub', new SeedStats())).rejects.toThrow(
      /OSS_HUB_SEED_CONFIRMATION/,
    );
  });

  it(
    '합성 auth 계정과 설정된 ADMIN 네 명의 프로그램 추적 데이터를 멱등하게 만든다',
    async () => {
      await runProfile('oss-hub', new SeedStats());
      const countsAfterFirstRun = await countAllSeeded();
      await runProfile('oss-hub', new SeedStats());
      const countsAfterSecondRun = await countAllSeeded();

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
        ossHubDocumentSubmissionCount,
        ossHubSubmissionHistoryCount,
        ossHubRepositoryCount,
        ossHubRepositoryProvisionJobCount,
      ] = await Promise.all([
        prisma.user.findUniqueOrThrow({
          where: { id: AUTH_SCENARIOS['admin-confirmed'] },
          include: { admin: true },
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
          include: { admin: true },
        }),
        prisma.program.findUniqueOrThrow({
          where: { id: OSS_HUB_PROGRAM_ID },
          include: { milestones: { orderBy: { id: 'asc' } } },
        }),
        prisma.team.findUniqueOrThrow({
          where: { id: OSS_HUB_TEAM_ID },
          include: { members: { orderBy: { userId: 'asc' } } },
        }),
        prisma.team.findUniqueOrThrow({
          where: { id: OSS_HUB_TEAM_ID },
        }),
        prisma.submission.findUniqueOrThrow({
          where: {
            id: seedId(
              'oss-hub',
              'milestone-document-submission',
              'aws-staging',
            ),
          },
          include: {
            histories: true,
          },
        }),
        prisma.submission.findUniqueOrThrow({
          where: {
            id: seedId(
              'oss-hub',
              'milestone-document-submission',
              'intake-freeze',
            ),
          },
          include: {
            histories: true,
          },
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
          include: { members: { orderBy: { userId: 'asc' } } },
        }),
        prisma.team.findUniqueOrThrow({
          where: { id: OSS_HUB_PRACTICE_TEAM_ID },
        }),
        prisma.githubRepository.findUniqueOrThrow({
          where: { id: OSS_HUB_PRACTICE_REPOSITORY_ID },
        }),
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { id: OSS_HUB_PRACTICE_PROVISION_JOB_ID },
        }),
        prisma.userPolicy.count({
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
          where: { teamId: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.milestone.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.team.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.submission.count({
          where: { id: { startsWith: 'seed:oss-hub:' } },
        }),
        prisma.submissionHistory.count({
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

      expect(syntheticAdmin.admin).not.toBeNull();
      expect(syntheticStaff).toMatchObject({
        type: 'STAFF',
        approvalStatus: 'APPROVED',
      });
      expect(syntheticStudent.type).toBe(UserType.STUDENT);
      expect(configuredUsers).toHaveLength(4);
      expect(
        configuredUsers.map(({ id, nickname, admin, accountStatus }) => ({
          id,
          nickname,
          hasAdminAccess: admin !== null,
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

      expect(configuredUsers.map((user) => user.name)).toEqual([
        '시드운영자알파',
        '시드운영자베타',
        '시드운영자감마',
        '시드운영자델타',
      ]);
      for (const configuredUser of configuredUsers) {
        expect(configuredUser.admin).not.toBeNull();
        expect(configuredUser.approvalStatus).toBe('PENDING');

        expect(configuredUser).toMatchObject({
          type: UserType.STAFF,
          departmentType: DepartmentType.PROGRAM_OFFICE,
          department: '오픈소스 SW 개발 사업단',
          studentId: null,
        });
      }

      expect(configuredUsersConsentCount).toBe(4);
      expect([ossHubProgramCount, ossHubTeamCount, ossHubMemberCount]).toEqual([
        1, 1, 4,
      ]);
      for (const noticeExample of OSS_HUB_NOTICE_EXAMPLES) {
        expect(program.description).toContain(noticeExample);
      }
      expect(program.repositoryProvisioningEnabled).toBe(true);

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
      expect(team.members.map(({ userId }) => ({ userId }))).toEqual(
        configuredUsers.map((user) => ({
          userId: user.id,
        })),
      );

      expect(ossHubApplicationCount).toBe(1);
      expect(application).toMatchObject({
        id: OSS_HUB_TEAM_ID,
        applicantId: configuredUsers[0]?.id,
        status: ApplicationStatus.APPROVED,
      });

      expect(ossHubDocumentSubmissionCount).toBe(2);
      expect(ossHubSubmissionHistoryCount).toBe(3);
      expect(awsStagingSubmission).toMatchObject({
        status: SubmissionStatus.APPROVED,
        revision: 1,
      });
      expect(awsStagingSubmission.histories).toHaveLength(2);
      expect(
        awsStagingSubmission.histories.find(
          (history) => history.event === ReviewDecision.APPROVED,
        ),
      ).toMatchObject({
        event: ReviewDecision.APPROVED,
        actorId: AUTH_SCENARIOS['staff-approved'],
      });

      expect(intakeFreezeSubmission).toMatchObject({
        status: SubmissionStatus.SUBMITTED,
        revision: 1,
      });
      expect(intakeFreezeSubmission.histories).toHaveLength(1);

      expect(ossHubRepositoryCount).toBe(1);
      expect(repository).toMatchObject({
        teamId: OSS_HUB_TEAM_ID,
        githubRepositoryId: OSS_HUB_GITHUB_REPOSITORY_ID,
        visibility: RepositoryVisibility.PUBLIC,
      });
      expect(
        repositoryUrlService.repositoryUrlFromNameWithOwner(
          repository.nameWithOwner,
        ),
      ).toBe(OSS_HUB_REPOSITORY_URL);
      expect(ossHubRepositoryProvisionJobCount).toBe(1);
      expect(provisionJob).toMatchObject({
        teamId: OSS_HUB_TEAM_ID,
        repositoryId: OSS_HUB_REPOSITORY_ID,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });

      expect(practiceProgram.repositoryProvisioningEnabled).toBe(true);
      expect(practiceTeam.leaderId).toBe(configuredUsers[0]?.id);
      expect(practiceTeam.members.map(({ userId }) => ({ userId }))).toEqual(
        configuredUsers.map((user) => ({
          userId: user.id,
        })),
      );
      expect(practiceApplication).toMatchObject({
        programId: OSS_HUB_PRACTICE_PROGRAM_ID,
        id: OSS_HUB_PRACTICE_TEAM_ID,
        applicantId: configuredUsers[0]?.id,
        status: ApplicationStatus.APPROVED,
      });
      expect(practiceRepository).toMatchObject({
        teamId: OSS_HUB_PRACTICE_TEAM_ID,
        githubRepositoryId: OSS_HUB_PRACTICE_GITHUB_REPOSITORY_ID,
        visibility: RepositoryVisibility.PUBLIC,
      });
      expect(
        repositoryUrlService.repositoryUrlFromNameWithOwner(
          practiceRepository.nameWithOwner,
        ),
      ).toBe(OSS_HUB_PRACTICE_REPOSITORY_URL);
      expect(practiceRepository.publishedAt).not.toBeNull();
      expect(practiceProvisionJob).toMatchObject({
        teamId: OSS_HUB_PRACTICE_TEAM_ID,
        repositoryId: OSS_HUB_PRACTICE_REPOSITORY_ID,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });
    },
    SEED_RUN_TIMEOUT_MS,
  );

  it(
    '이전 마일스톤 구성이 남긴 제출 원장·판정 이력이 있어도 FK 오류 없이 정리하고 새 7개로 수렴한다',
    async () => {
      await runProfile('oss-hub', new SeedStats());
      const staleMilestoneId = seedId('oss-hub', 'milestone', 'obsolete-plan');
      const program = await prisma.program.findUniqueOrThrow({
        where: { id: OSS_HUB_PROGRAM_ID },
      });
      await prisma.milestone.create({
        data: {
          startAt: program.startAt,

          id: staleMilestoneId,
          programId: OSS_HUB_PROGRAM_ID,
          name: '구버전 계획서 제출',
          dueAt: new Date(program.startAt.getTime() + 86_400_000),
          instructions: '정리 테스트용 구버전 마일스톤(obsolete-plan).',
        },
      });
      const staleDocumentId = seedId(
        'oss-hub',
        'milestone-document',
        'obsolete-plan',
      );
      await prisma.requirement.create({
        data: {
          id: staleDocumentId,
          milestoneId: staleMilestoneId,
          name: '구버전 계획서',
          required: true,
          sortOrder: 0,
          submissionType: MilestoneSubmissionType.TEXT,
        },
      });
      const staleSubmissionId = seedId(
        'oss-hub',
        'milestone-document-submission',
        'obsolete-plan',
      );
      await prisma.submission.create({
        data: {
          id: staleSubmissionId,
          requirementId: staleDocumentId,
          teamId: OSS_HUB_TEAM_ID,
          status: SubmissionStatus.SUBMITTED,
          revision: 1,
          content: {
            type: MilestoneSubmissionType.TEXT,
            text: '구버전 제출 (stale cleanup test).',
          },
          submittedById: AUTH_SCENARIOS['staff-approved'],
        },
      });
      const staleHistoryId = seedId(
        'oss-hub',
        'milestone-document-submission-history',
        'obsolete-plan',
        'submitted',
      );
      await prisma.submissionHistory.create({
        data: {
          id: staleHistoryId,
          submissionId: staleSubmissionId,
          event: SubmissionHistoryEvent.SUBMITTED,
          revision: 1,
          content: {
            type: MilestoneSubmissionType.TEXT,
            text: '구버전 제출 (stale cleanup test).',
          },
          actorId: AUTH_SCENARIOS['staff-approved'],
        },
      });
      const staleReviewId = seedId(
        'oss-hub',
        'milestone-document-review-history',
        'obsolete-plan',
      );
      await prisma.submissionHistory.create({
        data: {
          id: staleReviewId,
          submissionId: staleSubmissionId,
          revision: 1,
          actorId: AUTH_SCENARIOS['staff-approved'],
          event: SubmissionHistoryEvent.APPROVED,
          comment: '구버전 판정 (stale cleanup test).',
        },
      });

      await expect(
        runProfile('oss-hub', new SeedStats()),
      ).resolves.not.toThrow();

      const [
        staleMilestone,
        staleDocument,
        staleSubmission,
        staleHistory,
        staleReview,
        milestoneCount,
      ] = await Promise.all([
        prisma.milestone.findUnique({ where: { id: staleMilestoneId } }),
        prisma.requirement.findUnique({ where: { id: staleDocumentId } }),
        prisma.submission.findUnique({
          where: { id: staleSubmissionId },
        }),
        prisma.submissionHistory.findUnique({
          where: { id: staleHistoryId },
        }),
        prisma.submissionHistory.findUnique({
          where: { id: staleReviewId },
        }),
        prisma.milestone.count({ where: { programId: OSS_HUB_PROGRAM_ID } }),
      ]);
      expect(staleMilestone).toBeNull();
      expect(staleDocument).toBeNull();
      expect(staleSubmission).toBeNull();
      expect(staleHistory).toBeNull();
      expect(staleReview).toBeNull();
      expect(milestoneCount).toBe(7);
    },
    SEED_RUN_TIMEOUT_MS,
  );
});

describe('seed profile=demo 계약 (integration)', () => {
  const seedDemoPrefix = 'seed:demo:';
  async function countDemoSeeded(): Promise<Record<string, number>> {
    const [
      users,
      programs,
      teams,
      teamMembers,
      applications,
      milestones,
      milestoneDocuments,
      documentSubmissions,
      submissionHistories,
      submissionFiles,
      boardPosts,
      boardComments,
      githubRepositories,
      contributions,
    ] = await Promise.all([
      prisma.user.count({ where: { id: { startsWith: seedDemoPrefix } } }),
      prisma.program.count({ where: { id: { startsWith: seedDemoPrefix } } }),
      prisma.team.count({ where: { id: { startsWith: seedDemoPrefix } } }),
      prisma.teamMember.count({
        where: { teamId: { startsWith: seedDemoPrefix } },
      }),
      prisma.team.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.milestone.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.requirement.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.submission.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.submissionHistory.count({
        where: { id: { startsWith: seedDemoPrefix } },
      }),
      prisma.file.count({
        where: { kind: 'SUBMISSION', id: { startsWith: seedDemoPrefix } },
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
      MilestoneDocument: milestoneDocuments,
      MilestoneDocumentSubmission: documentSubmissions,
      MilestoneDocumentSubmissionHistory: submissionHistories,
      SubmissionFile: submissionFiles,
      BoardPost: boardPosts,
      BoardComment: boardComments,
      GithubRepository: githubRepositories,
      Contribution: contributions,
    };
  }
  async function deleteDemoSeeded(): Promise<void> {
    const seedIdFilter = { id: { startsWith: seedDemoPrefix } } as const;
    const demoFileStorageKeys = (
      await prisma.file.findMany({
        where: seedIdFilter,
        select: { storageKey: true },
      })
    ).map((file) => file.storageKey);
    await prisma.file.deleteMany({ where: seedIdFilter });
    await prisma.submissionHistory.deleteMany({
      where: seedIdFilter,
    });
    await prisma.submission.deleteMany({
      where: seedIdFilter,
    });
    await prisma.requirement.deleteMany({ where: seedIdFilter });
    await prisma.boardComment.deleteMany({ where: seedIdFilter });
    await prisma.boardPost.deleteMany({ where: seedIdFilter });
    await prisma.teamMember.deleteMany({ where: { teamId: seedIdFilter.id } });
    await prisma.milestone.deleteMany({ where: seedIdFilter });
    await prisma.team.deleteMany({ where: seedIdFilter });
    await prisma.team.deleteMany({ where: seedIdFilter });
    await prisma.program.deleteMany({ where: seedIdFilter });
    await prisma.userPolicy.deleteMany({
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
      const firstRunStats = new SeedStats();
      await runProfile('demo', firstRunStats);
      const countsAfterFirstRun = await countDemoSeeded();
      const secondRunStats = new SeedStats();
      await runProfile('demo', secondRunStats);
      const countsAfterSecondRun = await countDemoSeeded();
      expect(countsAfterSecondRun).toEqual(countsAfterFirstRun);
      expect(countsAfterFirstRun.Program).toBeGreaterThanOrEqual(3);
      expect(countsAfterFirstRun.Program).toBeLessThanOrEqual(4);
      expect(countsAfterFirstRun.User).toBeGreaterThan(0);
      expect(countsAfterFirstRun.Team).toBeGreaterThanOrEqual(6);
      expect(countsAfterFirstRun.Application).toBeGreaterThanOrEqual(6);
      expect(countsAfterFirstRun.Milestone).toBeGreaterThan(0);
      expect(
        countsAfterFirstRun.MilestoneDocumentSubmission,
      ).toBeGreaterThanOrEqual(9);
      expect(countsAfterFirstRun.SubmissionFile).toBeGreaterThan(0);
      const reviewEvents = await prisma.submissionHistory.count({
        where: {
          id: { startsWith: seedDemoPrefix },
          event: { in: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] },
        },
      });
      const reviewedSubmissions = await prisma.submission.count({
        where: {
          id: { startsWith: seedDemoPrefix },
          status: { in: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] },
        },
      });
      expect(reviewEvents).toBe(reviewedSubmissions);
      expect(countsAfterFirstRun.BoardPost).toBeGreaterThan(0);
      expect(countsAfterFirstRun.BoardComment).toBeGreaterThan(0);
      expect(countsAfterFirstRun.GithubRepository).toBe(0);
      expect(countsAfterFirstRun.Contribution).toBe(0);
      expect(countsAfterSecondRun.GithubRepository).toBe(0);
      expect(countsAfterSecondRun.Contribution).toBe(0);
      const demoUsers = await prisma.user.findMany({
        where: { id: { startsWith: seedDemoPrefix } },
        select: {
          notificationEmail: true,
          name: true,
        },
      });
      expect(demoUsers.length).toBeGreaterThan(0);
      for (const user of demoUsers) {
        expect(user.notificationEmail).toMatch(/@demo\.invalid$/);
      }
      expect(demoUsers.some((user) => user.name === '김도윤')).toBe(true);
      const demoPrograms = await prisma.program.findMany({
        where: { id: { startsWith: seedDemoPrefix } },
        select: { name: true, repositoryProvisioningEnabled: true },
      });
      expect(
        demoPrograms.some((program) => program.name.includes('에코노베이션')),
      ).toBe(true);
      for (const program of demoPrograms) {
        expect(program.repositoryProvisioningEnabled).toBe(false);
      }
      const demoSubmissions = await prisma.submission.findMany({
        where: { id: { startsWith: seedDemoPrefix } },
        select: {
          id: true,
          content: true,
          requirement: {
            select: { submissionType: true },
          },
        },
      });
      expect(demoSubmissions.length).toBeGreaterThan(0);
      for (const submission of demoSubmissions) {
        const milestoneSubmissionType = submission.requirement.submissionType;
        expect(
          (
            submission.content as {
              readonly type: string;
            }
          ).type,
        ).toBe(milestoneSubmissionType);
      }
      const fileTypeSubmissions = demoSubmissions.filter(
        (submission) => submission.requirement.submissionType === 'FILE',
      );
      expect(fileTypeSubmissions.length).toBeGreaterThan(0);
      for (const submission of fileTypeSubmissions) {
        const fileId = (
          submission.content as {
            readonly fileId: string;
          }
        ).fileId;
        const submissionFile = await prisma.file.findUniqueOrThrow({
          where: { kind: 'SUBMISSION', id: fileId },
        });
        expect(submissionFile.submissionId).toBe(submission.id);
        expect(submissionFile.submissionHistoryId).not.toBeNull();
        const fileHistory = await prisma.submissionHistory.findUniqueOrThrow({
          where: {
            id: submissionFile.submissionHistoryId!,
          },
          select: { submissionId: true },
        });
        expect(fileHistory.submissionId).toBe(submission.id);
        expect(submissionFile.lifecycle).toBe('ATTACHED');
      }
      const contestProgramId = seedId(
        'demo',
        'program',
        'oss-developer-contest',
      );
      const contestTeams = await prisma.team.count({
        where: { programId: contestProgramId },
      });
      expect(contestTeams).toBeGreaterThanOrEqual(5);
      const contestApplications = await prisma.team.findMany({
        where: { programId: contestProgramId },
        select: { status: true },
      });
      expect(contestApplications.length).toBeGreaterThanOrEqual(5);
      for (const application of contestApplications) {
        expect(application.status).toBe(ApplicationStatus.APPROVED);
      }
      const contestSubmissionStatuses = await prisma.submission.findMany({
        where: {
          requirement: {
            milestone: { programId: contestProgramId },
          },
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
      expect(firstRunStats.report().length).toBeGreaterThan(0);
      expect(secondRunStats.report().length).toBeGreaterThan(0);
    },
    SEED_RUN_TIMEOUT_MS,
  );
  it(
    '보강된 다팀 그래프도 teardown 없이 두 번째 실행에서 멱등하다(팀·지원서·마일스톤 제출 상태 포함)',
    async () => {
      await runProfile('demo', new SeedStats());
      const firstRun = await countDemoSeeded();
      await runProfile('demo', new SeedStats());
      const secondRun = await countDemoSeeded();
      expect(secondRun).toEqual(firstRun);
    },
    SEED_RUN_TIMEOUT_MS,
  );
  it(
    '한빛 팀 데모데이 제출 원장은 보존 id를 유지해 재시드해도 항목별 고유 제약을 깨드리지 않는다',
    async () => {
      await runProfile('demo', new SeedStats());

      const contestApplicationId = seedId('demo', 'team', 'oss-contest-hanbit');
      const contestMilestoneId = seedId(
        'demo',
        'milestone',
        'oss-contest-demo-day',
      );
      const preservedSubmissionId = seedId(
        'demo',
        'milestone-document-submission',
        'oss-contest-demo-day',
      );
      const preservedHistoryId = seedId(
        'demo',
        'milestone-document-submission',
        'oss-contest-demo-day',
        'history-1',
      );
      const preservedFileId = seedId(
        'demo',
        'submission-file',
        'oss-contest-demo-day',
      );
      const parkHaeunUserId = seedId('demo', 'user', 'park-haeun');
      const contestDocumentId = seedId(
        'demo',
        'milestone-document',
        contestMilestoneId,
      );
      await prisma.file.deleteMany({
        where: { kind: 'SUBMISSION', id: preservedFileId },
      });
      await prisma.submissionHistory.deleteMany({
        where: { submissionId: preservedSubmissionId },
      });
      await prisma.submission.deleteMany({
        where: { id: preservedSubmissionId },
      });
      await prisma.submission.create({
        data: {
          id: preservedSubmissionId,
          requirementId: contestDocumentId,
          teamId: contestApplicationId,
          status: SubmissionStatus.SUBMITTED,
          revision: 1,
          content: {
            type: MilestoneSubmissionType.FILE,
            fileId: preservedFileId,
          },
          submittedById: parkHaeunUserId,
        },
      });
      await prisma.submissionHistory.create({
        data: {
          id: preservedHistoryId,
          submissionId: preservedSubmissionId,
          event: SubmissionHistoryEvent.SUBMITTED,
          revision: 1,
          content: {
            type: MilestoneSubmissionType.FILE,
            fileId: preservedFileId,
          },
          actorId: parkHaeunUserId,
        },
      });
      await prisma.file.create({
        data: {
          kind: 'SUBMISSION',
          id: preservedFileId,
          uploaderId: parkHaeunUserId,
          teamId: contestApplicationId,
          submissionId: preservedSubmissionId,
          submissionHistoryId: preservedHistoryId,
          storageKey: `demo/${preservedFileId}`,
          originalFileName: 'oss-contest-demo-day-draft.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1048576,
          lifecycle: 'ATTACHED',
        },
      });
      await expect(runProfile('demo', new SeedStats())).resolves.not.toThrow();
      const submissionsForPair = await prisma.submission.findMany({
        where: {
          teamId: contestApplicationId,
          requirementId: contestDocumentId,
        },
      });
      expect(submissionsForPair).toHaveLength(1);
      expect(submissionsForPair[0]?.id).toBe(preservedSubmissionId);
      const [preservedHistory, preservedFile, teamSuffixedSubmission] =
        await Promise.all([
          prisma.submissionHistory.findUnique({
            where: { id: preservedHistoryId },
          }),
          prisma.file.findUnique({
            where: { kind: 'SUBMISSION', id: preservedFileId },
          }),
          prisma.submission.findUnique({
            where: {
              id: seedId(
                'demo',
                'milestone-document-submission',
                'oss-contest-hanbit-demo-day',
              ),
            },
          }),
        ]);
      expect(preservedHistory).not.toBeNull();
      expect(preservedFile).not.toBeNull();
      expect(teamSuffixedSubmission).toBeNull();
    },
    SEED_RUN_TIMEOUT_MS,
  );
  it(
    'teardown은 시드 후 모든 demo-touched 테이블에서 seed:demo: 행을 0건으로 만든다',
    async () => {
      await runProfile('demo', new SeedStats());
      const countsBeforeTeardown = await countDemoSeeded();
      expect(countsBeforeTeardown.User).toBeGreaterThan(0);
      expect(countsBeforeTeardown.Program).toBeGreaterThan(0);
      expect(countsBeforeTeardown.Team).toBeGreaterThan(0);
      expect(countsBeforeTeardown.MilestoneDocumentSubmission).toBeGreaterThan(
        0,
      );
      expect(
        countsBeforeTeardown.MilestoneDocumentSubmissionHistory,
      ).toBeGreaterThan(0);
      await runTeardown('demo', new SeedStats());
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
      await runProfile('demo', new SeedStats());
      const survivorUserId = 'seed:demo-teardown-guard:user';
      const survivorProgramId = 'seed:demo-teardown-guard:program';
      const survivorTeamId = 'seed:demo-teardown-guard:team';

      await prisma.user.create({
        data: {
          id: survivorUserId,
          githubId: seedGithubId(survivorUserId),
          nickname: 'demo-teardown-guard',
          type: UserType.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
        },
      });
      await prisma.program.create({
        data: {
          startAt: new Date('2020-01-01T00:00:00Z'),
          endAt: new Date(
            new Date('2020-01-02T00:00:00Z').getTime() + 365 * 86400000,
          ),
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
          leaderId: survivorUserId,
          applicantId: survivorUserId,
          answers: {},
          applicationTemplateVersion: 1,
        },
      });
      await prisma.teamMember.create({
        data: {
          teamId: survivorTeamId,
          programId: survivorProgramId,
          userId: survivorUserId,
        },
      });
      await prisma.team.update({
        where: { id: survivorTeamId },
        data: {
          answers: { seedPlaceholder: true, scenarioId: 'teardown-guard' },
          status: ApplicationStatus.APPROVED,
        },
      });
      try {
        await runTeardown('demo', new SeedStats());
        const demoCountsAfterTeardown = await countDemoSeeded();
        for (const count of Object.values(demoCountsAfterTeardown)) {
          expect(count).toBe(0);
        }

        const [survivorUser, survivorProgram, survivorTeam] = await Promise.all(
          [
            prisma.user.findUnique({ where: { id: survivorUserId } }),
            prisma.program.findUnique({ where: { id: survivorProgramId } }),
            prisma.team.findUnique({ where: { id: survivorTeamId } }),
          ],
        );
        expect(survivorUser).not.toBeNull();
        expect(survivorProgram).not.toBeNull();
        expect(survivorTeam).toMatchObject({
          id: survivorTeamId,
          status: ApplicationStatus.APPROVED,
          answers: { seedPlaceholder: true, scenarioId: 'teardown-guard' },
        });
      } finally {
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
  it(
    'ATTACHED SubmissionFile은 reconciliation 소유 prefix 아래의 실제 검색 가능한 객체를 가진다',
    async () => {
      await runProfile('demo', new SeedStats());
      const demoFiles = await prisma.file.findMany({
        where: { kind: 'SUBMISSION', id: { startsWith: seedDemoPrefix } },
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
      await runProfile('demo', new SeedStats());
      const firstRunFiles = await prisma.file.findMany({
        where: { kind: 'SUBMISSION', id: { startsWith: seedDemoPrefix } },
        select: { storageKey: true },
        orderBy: { id: 'asc' },
      });
      await runProfile('demo', new SeedStats());
      const secondRunFiles = await prisma.file.findMany({
        where: { kind: 'SUBMISSION', id: { startsWith: seedDemoPrefix } },
        select: { storageKey: true },
        orderBy: { id: 'asc' },
      });
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
      await runProfile('demo', new SeedStats());
      const demoFiles = await prisma.file.findMany({
        where: { kind: 'SUBMISSION', id: { startsWith: seedDemoPrefix } },
        select: { storageKey: true },
      });
      expect(demoFiles.length).toBeGreaterThan(0);
      const survivorKey = `submission-files/seed-demo-teardown-guard-${Date.now()}`;
      await demoStorage.put({
        objectKey: survivorKey,
        originalName: 'survivor.txt',
        contentType: 'text/plain',
        body: Buffer.from('teardown이 지우면 안 되는 비-demo 객체(fixture)'),
      });
      try {
        await runTeardown('demo', new SeedStats());
        for (const file of demoFiles) {
          await expect(demoStorageObjectExists(file.storageKey)).resolves.toBe(
            false,
          );
        }
        await expect(demoStorageObjectExists(survivorKey)).resolves.toBe(true);
      } finally {
        await demoStorage.delete(survivorKey);
      }
    },
    SEED_RUN_TIMEOUT_MS,
  );
  it('production에서는 SEED_DEMO_ALLOW_PRODUCTION=1 없이 거부된다', () => {
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
describe('seed profile=all 멱등성 (integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);
  afterAll(async () => {
    try {
      await deleteAllSeeded();
    } finally {
      await prisma.$disconnect();
    }
  });
  it(
    '같은 profile을 두 번 실행해도 seed: 행 수가 그대로다',
    async () => {
      const firstRunStats = new SeedStats();
      await runProfile('all', firstRunStats);
      const countsAfterFirstRun = await countAllSeeded();
      const secondRunStats = new SeedStats();
      await runProfile('all', secondRunStats);
      const countsAfterSecondRun = await countAllSeeded();
      expect(countsAfterSecondRun).toEqual(countsAfterFirstRun);
      const totalRows = Object.values(countsAfterSecondRun).reduce(
        (sum, count) => sum + count,
        0,
      );
      expect(totalRows).toBeGreaterThan(0);
      const documentSubmissions = await prisma.submission.findMany({
        where: { id: { startsWith: 'seed:program-overview:' } },
        select: {
          revision: true,
          histories: {
            where: {
              event: {
                in: [
                  SubmissionHistoryEvent.SUBMITTED,
                  SubmissionHistoryEvent.RESUBMITTED,
                ],
              },
            },
            select: { id: true, revision: true },
          },
          files: {
            select: { submissionHistoryId: true },
          },
        },
      });
      expect(documentSubmissions.length).toBeGreaterThan(0);
      for (const submission of documentSubmissions) {
        const current = submission.histories.filter(
          (history) => history.revision === submission.revision,
        );
        expect(current).toHaveLength(1);
        expect(
          submission.files.every(
            (file) => file.submissionHistoryId === current[0]?.id,
          ),
        ).toBe(true);
      }
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
    await prisma.userPolicy.deleteMany({
      where: {
        userId: { in: [consentRequiredUserId, roleUnselectedUserId] },
      },
    });
    await prisma.$disconnect();
  });
  it(
    'auth profile은 미동의·현행 동의·과거 버전을 두 실행 뒤에도 보존한다',
    async () => {
      const setupStats = new SeedStats();
      await upsertSeedUser(setupStats, {
        id: consentRequiredUserId,
        role: null,
      });
      await upsertSeedUser(setupStats, {
        id: roleUnselectedUserId,
        role: null,
      });
      await prisma.userPolicy.deleteMany({
        where: {
          userId: { in: [consentRequiredUserId, roleUnselectedUserId] },
        },
      });
      const olderConsent = await prisma.userPolicy.create({
        data: {
          userId: roleUnselectedUserId,
          policyVersion: ISSUE99_OLDER_POLICY_VERSION,
        },
      });
      await runProfile('auth', new SeedStats());
      const firstCurrent = await prisma.userPolicy.findUnique({
        where: {
          userId_policyVersion: {
            userId: roleUnselectedUserId,
            policyVersion: CONSENT_POLICY_VERSION,
          },
        },
      });
      await runProfile('auth', new SeedStats());
      const [
        consentRequiredCount,
        roleUnselectedRows,
        profileComplete,
        staffPending,
        staffPendingSecond,
        staffRejected,
        staffRevoked,
      ] = await Promise.all([
        prisma.userPolicy.count({ where: { userId: consentRequiredUserId } }),
        prisma.userPolicy.findMany({
          where: { userId: roleUnselectedUserId },
          orderBy: { policyVersion: 'asc' },
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: profileCompleteUserId },
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: staffPendingUserId },
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: staffPendingSecondUserId },
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: staffRejectedUserId },
        }),
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
      expect(staffPending).toMatchObject({
        type: UserType.STAFF,
        studentId: null,
        department: '인공지능학부',
      });
      expect(staffPendingSecond).toMatchObject({
        type: UserType.STAFF,
        studentId: null,
        department: '소프트웨어공학과',
      });
      expect(staffRejected).toMatchObject({
        type: UserType.STAFF,
        studentId: null,
        department: '컴퓨터공학과',
      });
      expect(staffRevoked).toMatchObject({
        type: UserType.STAFF,
        approvalStatus: ApprovalStatus.APPROVED,
        accountStatus: AccountStatus.DEACTIVATED,
      });
    },
    SEED_RUN_TIMEOUT_MS,
  );
});
describe('#184 관리자 e2e 페르소나 (integration)', () => {
  const authPrisma = new PrismaService();
  const authRepository = new AuthRepository(authPrisma);
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
      await runProfile('auth', new SeedStats());
      await runProfile('auth', new SeedStats());
      const [admin, adminSecond] = await Promise.all([
        authRepository.findByGithubId(seedGithubId(adminConfirmedUserId)),
        authRepository.findByGithubId(seedGithubId(adminSecondUserId)),
      ]);
      expect(admin?.id).toBe(adminConfirmedUserId);
      expect(admin?.hasAdminAccess).toBe(true);
      expect(admin?.accountStatus).toBe(AccountStatus.ACTIVE);
      expect(isProfileComplete(admin)).toBe(true);
      expect(adminSecond?.id).toBe(adminSecondUserId);
      expect(adminSecond?.hasAdminAccess).toBe(true);
      expect(adminSecond?.accountStatus).toBe(AccountStatus.ACTIVE);
      expect(isProfileComplete(adminSecond)).toBe(true);
      const [adminRow, adminSecondRow] = await Promise.all([
        prisma.user.findUniqueOrThrow({
          where: { id: adminConfirmedUserId },
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: adminSecondUserId },
        }),
      ]);
      expect(adminRow.name).toBe('합성 관리자');
      expect(adminSecondRow.name).toBe('합성 두 번째 관리자');
      expect(adminRow.studentId).toBeNull();
      expect(adminRow.type).toBe(UserType.STAFF);
      expect(adminRow.departmentType).toBe(DepartmentType.PROGRAM_OFFICE);
    },
    SEED_RUN_TIMEOUT_MS,
  );
  it(
    'staff-revocable은 회수를 누를 수 있는 ACTIVE·STAFF·승인 완료 상태다',
    async () => {
      await runProfile('auth', new SeedStats());
      const revocable = await authRepository.findByGithubId(
        seedGithubId(staffRevocableUserId),
      );
      expect(revocable?.id).toBe(staffRevocableUserId);
      expect(revocable?.memberKind).toBe('STAFF');
      expect(revocable?.approvalStatus).toBe('APPROVED');
      expect(revocable?.accountStatus).toBe(AccountStatus.ACTIVE);
      expect(isProfileComplete(revocable)).toBe(true);
      const { items: requests } =
        await new AdminAccessHistoryRepository().listAdminAccessStaffAccessRequestHistory(
          prisma,
          staffRevocableUserId,
          { page: 1, limit: 10 },
        );
      expect(requests.length).toBe(1);
      expect(requests[0]?.status).toBe(ApprovalStatus.APPROVED);
      expect(requests[0]?.decidedBy).toBe('seed-auth-admin-confirmed');
      const revoked = await prisma.user.findUniqueOrThrow({
        where: { id: staffRevokedUserId },
      });
      expect(revoked.accountStatus).toBe(AccountStatus.DEACTIVATED);
      expect(revoked).toMatchObject({
        type: 'STAFF',
        approvalStatus: 'APPROVED',
      });
    },
    SEED_RUN_TIMEOUT_MS,
  );
});
