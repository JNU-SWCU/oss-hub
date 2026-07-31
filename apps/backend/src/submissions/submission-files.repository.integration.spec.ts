import {
  AccountStatus,
  MilestoneSubmissionType,
  Role,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { runProfile } from '../../prisma/seed';
import {
  prisma as seedPrisma,
  seedGithubId,
  seedId,
  SeedStats,
} from '../../prisma/seeds/helpers';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionFilesRepository } from './submission-files.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new SubmissionFilesRepository(prisma);
const NOW = new Date('2026-07-31T00:00:00.000Z');
const FUTURE_EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z');
const PAST_EXPIRES_AT = new Date('2026-01-01T00:00:00.000Z');
const PROGRAM_ID = seedId('milestones', 'program');
const APPLICATION_ID = seedId('milestones', 'application', 'personal');
const PARTICIPANT_USER_ID = seedId('milestones', 'user', 'applicant-personal');
const MILESTONE_ID = 'issue-342-download-milestone';
const SUBMISSION_ID = 'issue-342-download-submission';
const REVISION_ID = 'issue-342-download-revision';
const DOWNLOADABLE_FILE_ID = 'issue-342-downloadable-file';
const PENDING_FILE_ID = 'issue-342-pending-file';
const EXPIRED_FILE_ID = 'issue-342-expired-file';
const ORPHAN_FILE_ID = 'issue-342-orphan-file';
const UNRELATED_STUDENT_USER_ID = 'issue-342-unrelated-student';
const STAFF_USER_ID = 'issue-342-staff';
const ADMIN_USER_ID = 'issue-342-admin';
const INACTIVE_USER_ID = 'issue-342-inactive-admin';
const PARTICIPANT_GITHUB_ID = seedGithubId(PARTICIPANT_USER_ID);
const UNRELATED_STUDENT_GITHUB_ID = 342_000_002n;
const STAFF_GITHUB_ID = 342_000_003n;
const ADMIN_GITHUB_ID = 342_000_004n;
const INACTIVE_GITHUB_ID = 342_000_005n;
const USER_RECORDS = [
  {
    id: UNRELATED_STUDENT_USER_ID,
    githubId: UNRELATED_STUDENT_GITHUB_ID,
    role: Role.STUDENT,
    accountStatus: AccountStatus.ACTIVE,
  },
  {
    id: STAFF_USER_ID,
    githubId: STAFF_GITHUB_ID,
    role: Role.STAFF,
    accountStatus: AccountStatus.ACTIVE,
  },
  {
    id: ADMIN_USER_ID,
    githubId: ADMIN_GITHUB_ID,
    role: Role.ADMIN,
    accountStatus: AccountStatus.ACTIVE,
  },
  {
    id: INACTIVE_USER_ID,
    githubId: INACTIVE_GITHUB_ID,
    role: Role.ADMIN,
    accountStatus: AccountStatus.DEACTIVATED,
  },
] satisfies readonly {
  readonly id: string;
  readonly githubId: bigint;
  readonly role: Role;
  readonly accountStatus: AccountStatus;
}[];
const FILE_IDS: string[] = [
  DOWNLOADABLE_FILE_ID,
  PENDING_FILE_ID,
  EXPIRED_FILE_ID,
  ORPHAN_FILE_ID,
];
const BASE_FILE = {
  uploaderId: PARTICIPANT_USER_ID,
  applicationId: APPLICATION_ID,
  milestoneId: MILESTONE_ID,
  mimeType: 'application/pdf',
} as const;
const AUTHORIZED_DOWNLOADS = [
  {
    scenario: 'allows the application participant uploader',
    githubId: PARTICIPANT_GITHUB_ID,
  },
  { scenario: 'allows active STAFF', githubId: STAFF_GITHUB_ID },
  { scenario: 'allows active ADMIN', githubId: ADMIN_GITHUB_ID },
] satisfies readonly { readonly scenario: string; readonly githubId: bigint }[];
const DENIED_DOWNLOADS = [
  {
    scenario: 'denies an unrelated active student',
    githubId: UNRELATED_STUDENT_GITHUB_ID,
    fileId: DOWNLOADABLE_FILE_ID,
  },
  {
    scenario: 'denies an inactive user',
    githubId: INACTIVE_GITHUB_ID,
    fileId: DOWNLOADABLE_FILE_ID,
  },
  {
    scenario: 'denies a PENDING file',
    githubId: ADMIN_GITHUB_ID,
    fileId: PENDING_FILE_ID,
  },
  {
    scenario: 'denies an expired file',
    githubId: ADMIN_GITHUB_ID,
    fileId: EXPIRED_FILE_ID,
  },
  {
    scenario: 'denies an attached file with no submissionRevision',
    githubId: ADMIN_GITHUB_ID,
    fileId: ORPHAN_FILE_ID,
  },
] satisfies readonly {
  readonly scenario: string;
  readonly githubId: bigint;
  readonly fileId: string;
}[];

async function deleteIssue342Rows(): Promise<void> {
  await prisma.submissionFile.deleteMany({ where: { id: { in: FILE_IDS } } });
  await prisma.submissionRevision.deleteMany({ where: { id: REVISION_ID } });
  await prisma.submission.deleteMany({ where: { id: SUBMISSION_ID } });
  await prisma.milestone.deleteMany({ where: { id: MILESTONE_ID } });
  await prisma.user.deleteMany({
    where: { id: { in: USER_RECORDS.map((user) => user.id) } },
  });
}

describe('SubmissionFilesRepository.findDownloadableFile integration', () => {
  beforeAll(async () => {
    await Promise.all([prisma.$connect(), seedPrisma.$connect()]);
    await runProfile('milestones', new SeedStats());
    await deleteIssue342Rows();
    await prisma.user.createMany({
      data: USER_RECORDS.map((user) => ({ ...user, nickname: user.id })),
    });
    await prisma.milestone.create({
      data: {
        id: MILESTONE_ID,
        programId: PROGRAM_ID,
        name: 'Issue 342 file authorization',
        dueAt: new Date('2026-08-31T00:00:00.000Z'),
        submissionType: MilestoneSubmissionType.FILE,
      },
    });
    await prisma.submission.create({
      data: {
        id: SUBMISSION_ID,
        applicationId: APPLICATION_ID,
        milestoneId: MILESTONE_ID,
        status: SubmissionStatus.SUBMITTED,
        currentRevision: 1,
      },
    });
    await prisma.submissionRevision.create({
      data: {
        id: REVISION_ID,
        submissionId: SUBMISSION_ID,
        revision: 1,
        submissionType: MilestoneSubmissionType.FILE,
        content: { type: 'FILE', fileId: DOWNLOADABLE_FILE_ID },
        submittedById: PARTICIPANT_USER_ID,
      },
    });
    await prisma.submissionFile.createMany({
      data: [
        {
          ...BASE_FILE,
          id: DOWNLOADABLE_FILE_ID,
          storageKey: 'submission-files/issue-342/downloadable',
          originalFileName: 'report.pdf',
          sizeBytes: 1024,
          submissionRevisionId: REVISION_ID,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          expiresAt: FUTURE_EXPIRES_AT,
        },
        {
          ...BASE_FILE,
          id: PENDING_FILE_ID,
          storageKey: 'submission-files/issue-342/pending',
          originalFileName: 'pending.pdf',
          sizeBytes: 2048,
          submissionRevisionId: REVISION_ID,
          lifecycle: SubmissionFileLifecycle.PENDING,
          expiresAt: FUTURE_EXPIRES_AT,
        },
        {
          ...BASE_FILE,
          id: EXPIRED_FILE_ID,
          storageKey: 'submission-files/issue-342/expired',
          originalFileName: 'expired.pdf',
          sizeBytes: 4096,
          submissionRevisionId: REVISION_ID,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          expiresAt: PAST_EXPIRES_AT,
        },
        {
          ...BASE_FILE,
          id: ORPHAN_FILE_ID,
          storageKey: 'submission-files/issue-342/orphan',
          originalFileName: 'orphan.pdf',
          sizeBytes: 8192,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          expiresAt: FUTURE_EXPIRES_AT,
        },
      ],
    });
  });

  afterAll(async () => {
    await deleteIssue342Rows();
    await Promise.all([prisma.$disconnect(), seedPrisma.$disconnect()]);
  });

  it.each(AUTHORIZED_DOWNLOADS)(
    '$scenario download access',
    async ({ githubId }) => {
      // Given: the requester is authorized for an attached, unexpired file.

      // When
      const file = await repository.findDownloadableFile(
        githubId,
        DOWNLOADABLE_FILE_ID,
        NOW,
      );

      // Then
      expect(file).toEqual({
        id: DOWNLOADABLE_FILE_ID,
        storageKey: 'submission-files/issue-342/downloadable',
        originalFileName: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        expiresAt: FUTURE_EXPIRES_AT,
      });
    },
  );

  it.each(DENIED_DOWNLOADS)(
    '$scenario download access',
    async ({ githubId, fileId }) => {
      // Given: the requester or file state does not satisfy download policy.

      // When
      const file = repository.findDownloadableFile(githubId, fileId, NOW);

      // Then
      await expect(file).resolves.toBeNull();
    },
  );
});
