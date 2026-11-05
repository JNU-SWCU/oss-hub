import { PlatformRepository } from '../platform/platform.repository';
import {
  AccountStatus,
  type Prisma,
  MilestoneDocumentSubmissionHistoryEvent,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { DepartmentType, MemberKind } from '../users/user-contract.config';
import { runProfile } from '../../prisma/seed';
import {
  prisma as seedPrisma,
  seedGithubId,
  seedId,
  SeedStats,
} from '../../prisma/seeds/helpers';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { SubmissionFilesRepository } from './submission-files.repository';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const repository = new SubmissionFilesRepository(
  prisma,
  new PlatformRepository(),
);
const NOW = new Date('2026-07-31T00:00:00.000Z');
const PENDING_EXPIRES_AT = new Date('2026-08-01T00:00:00.000Z');
const FUTURE_EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z');
const PAST_EXPIRES_AT = new Date('2026-01-01T00:00:00.000Z');
const PROGRAM_ID = seedId('milestones', 'program');
const TEAM_ID = seedId('milestones', 'team');
const UPLOADER_USER_ID = seedId('milestones', 'user', 'team-leader');
const TEAM_MEMBER_USER_ID = seedId('milestones', 'user', 'team-member');
const MILESTONE_ID = 'issue-342-download-milestone';
const MILESTONE_DOCUMENT_ID = 'issue-342-download-milestone-document';
const MILESTONE_DOCUMENT_SUBMISSION_ID =
  'issue-342-download-milestone-document-submission';
const MILESTONE_DOCUMENT_SUBMISSION_HISTORY_ID =
  'issue-342-download-milestone-document-submission-history';
const DOWNLOADABLE_FILE_ID = 'issue-342-downloadable-file';
const PENDING_FILE_ID = 'issue-342-pending-file';
const EXPIRED_FILE_ID = 'issue-342-expired-file';
const UNRELATED_STUDENT_USER_ID = 'issue-342-unrelated-student';
const STAFF_USER_ID = 'issue-342-staff';
const ADMIN_USER_ID = 'issue-342-admin';
const INACTIVE_USER_ID = 'issue-342-inactive-admin';
const UPLOADER_GITHUB_ID = seedGithubId(UPLOADER_USER_ID);
const TEAM_MEMBER_GITHUB_ID = seedGithubId(TEAM_MEMBER_USER_ID);
const UNRELATED_STUDENT_GITHUB_ID = 342000002n;
const STAFF_GITHUB_ID = 342000003n;
const ADMIN_GITHUB_ID = 342000004n;
const INACTIVE_GITHUB_ID = 342000005n;
const USER_RECORDS = [
  {
    id: UNRELATED_STUDENT_USER_ID,
    githubId: UNRELATED_STUDENT_GITHUB_ID,
    accountStatus: AccountStatus.ACTIVE,
    type: MemberKind.STUDENT,
    approvalStatus: 'NOT_REQUIRED',
  },
  {
    id: STAFF_USER_ID,
    githubId: STAFF_GITHUB_ID,
    accountStatus: AccountStatus.ACTIVE,
    type: MemberKind.STAFF,
    approvalStatus: 'APPROVED',
    name: 'Synthetic staff',
    department: 'Synthetic department',
    profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
    profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    departmentType: 'DEPARTMENT',
  },
  {
    id: ADMIN_USER_ID,
    githubId: ADMIN_GITHUB_ID,
    admin: { create: { origin: 'MIGRATION' } },
    accountStatus: AccountStatus.ACTIVE,
  },
  {
    id: INACTIVE_USER_ID,
    githubId: INACTIVE_GITHUB_ID,
    admin: { create: { origin: 'MIGRATION' } },
    accountStatus: AccountStatus.DEACTIVATED,
  },
] satisfies readonly Omit<Prisma.UserCreateInput, 'nickname'>[];
const FILE_IDS: string[] = [
  DOWNLOADABLE_FILE_ID,
  PENDING_FILE_ID,
  EXPIRED_FILE_ID,
];
const BASE_FILE = {
  uploaderId: UPLOADER_USER_ID,
  teamId: TEAM_ID,
  milestoneId: MILESTONE_ID,
  mimeType: 'application/pdf',
} as const;
const AUTHORIZED_DOWNLOADS = [
  {
    scenario: 'allows the application participant uploader',
    githubId: UPLOADER_GITHUB_ID,
  },
  {
    scenario: 'allows a team member who did not upload the file',
    githubId: TEAM_MEMBER_GITHUB_ID,
  },
  { scenario: 'allows active STAFF', githubId: STAFF_GITHUB_ID },
] satisfies readonly {
  readonly scenario: string;
  readonly githubId: bigint;
}[];
const DENIED_DOWNLOADS = [
  {
    scenario: 'denies admin without staff or participation',
    githubId: ADMIN_GITHUB_ID,
    fileId: DOWNLOADABLE_FILE_ID,
  },
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
] satisfies readonly {
  readonly scenario: string;
  readonly githubId: bigint;
  readonly fileId: string;
}[];
async function deleteIssue342Rows(): Promise<void> {
  await prisma.submissionFile.deleteMany({ where: { id: { in: FILE_IDS } } });
  await prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: { id: MILESTONE_DOCUMENT_SUBMISSION_HISTORY_ID },
  });
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { id: MILESTONE_DOCUMENT_SUBMISSION_ID },
  });
  await prisma.milestoneDocument.deleteMany({
    where: { id: MILESTONE_DOCUMENT_ID },
  });
  await prisma.milestone.deleteMany({ where: { id: MILESTONE_ID } });
  await prisma.admin.deleteMany({
    where: { userId: { in: USER_RECORDS.map((user) => user.id) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: USER_RECORDS.map((user) => user.id) } },
  });
}
describe('SubmissionFilesRepository.findDownloadableFile integration', () => {
  beforeAll(async () => {
    await Promise.all([prisma.$connect(), seedPrisma.$connect()]);
    await runProfile('milestones', new SeedStats());
    await deleteIssue342Rows();
    await Promise.all(
      USER_RECORDS.map((user) => ({ ...user, nickname: user.id })).map((data) =>
        prisma.user.create({ data }),
      ),
    );
    await prisma.user.update({
      where: { id: UNRELATED_STUDENT_USER_ID },
      data: {
        name: '합성 무관 학생',
        studentId: '342002',
        department: '합성 학과',
        type: MemberKind.STUDENT,
        departmentType: DepartmentType.DEPARTMENT,
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const program = await prisma.program.findUniqueOrThrow({
      where: { id: PROGRAM_ID },
    });
    await prisma.milestone.create({
      data: {
        startAt: program.startAt,
        id: MILESTONE_ID,
        programId: PROGRAM_ID,
        name: 'Issue 342 file authorization',
        dueAt: new Date(program.startAt.getTime() + 86400000),
      },
    });
    await prisma.milestoneDocument.create({
      data: {
        id: MILESTONE_DOCUMENT_ID,
        milestoneId: MILESTONE_ID,
        name: 'Internal legacy milestone submission',
        required: true,
        sortOrder: 0,
      },
    });
    await prisma.milestoneDocumentSubmission.create({
      data: {
        id: MILESTONE_DOCUMENT_SUBMISSION_ID,
        milestoneDocumentId: MILESTONE_DOCUMENT_ID,
        teamId: TEAM_ID,
        status: SubmissionStatus.SUBMITTED,
        revision: 1,
        submittedById: UPLOADER_USER_ID,
      },
    });
    await prisma.milestoneDocumentSubmissionHistory.create({
      data: {
        id: MILESTONE_DOCUMENT_SUBMISSION_HISTORY_ID,
        milestoneDocumentSubmissionId: MILESTONE_DOCUMENT_SUBMISSION_ID,
        event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
        revision: 1,
        content: { type: 'FILE', fileId: DOWNLOADABLE_FILE_ID },
        actorId: UPLOADER_USER_ID,
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
          milestoneDocumentSubmissionId: MILESTONE_DOCUMENT_SUBMISSION_ID,
          milestoneDocumentSubmissionHistoryId:
            MILESTONE_DOCUMENT_SUBMISSION_HISTORY_ID,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          expiresAt: FUTURE_EXPIRES_AT,
        },
        {
          ...BASE_FILE,
          id: PENDING_FILE_ID,
          storageKey: 'submission-files/issue-342/pending',
          originalFileName: 'pending.pdf',
          sizeBytes: 2048,
          lifecycle: SubmissionFileLifecycle.PENDING,
          pendingExpiresAt: PENDING_EXPIRES_AT,
          expiresAt: FUTURE_EXPIRES_AT,
        },
        {
          ...BASE_FILE,
          id: EXPIRED_FILE_ID,
          storageKey: 'submission-files/issue-342/expired',
          originalFileName: 'expired.pdf',
          sizeBytes: 4096,
          milestoneDocumentSubmissionId: MILESTONE_DOCUMENT_SUBMISSION_ID,
          milestoneDocumentSubmissionHistoryId:
            MILESTONE_DOCUMENT_SUBMISSION_HISTORY_ID,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          expiresAt: PAST_EXPIRES_AT,
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
      const file = await repository.findDownloadableFile(
        githubId,
        DOWNLOADABLE_FILE_ID,
        NOW,
      );
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
      const file = repository.findDownloadableFile(githubId, fileId, NOW);
      await expect(file).resolves.toBeNull();
    },
  );
});
