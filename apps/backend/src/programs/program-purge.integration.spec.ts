import { createHash } from 'node:crypto';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  AccountStatus,
  ApplicationStatus,
  BoardPostCategory,
  CollectionStreamType,
  MemberKind,
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  MilestoneSubmissionType,
  Prisma,
  ProgramAuthoringUploadLifecycle,
  ProgramCategory,
  ProgramLifecycle,
  ProgramPurgeFileTombstoneLifecycle,
  RepositoryInvitationStatus,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ReviewDecision,
  SubmissionFileLifecycle,
  SubmissionStatus,
  TeamInvitationStatus,
  ProgramTrackType,
} from '@prisma/client';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { S3SubmissionFileStorage } from '../submissions/s3-submission-file.storage';
import { SubmissionFileCleanupService } from '../submissions/submission-file-cleanup.service';
import { SubmissionFileStorageConfig } from '../submissions/submission-file-storage.config';
import { SubmissionFilesRepository } from '../submissions/submission-files.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PublicProjectsRepository } from './archive/public-projects/public-projects.repository';
import { readProgramDeletionScopeCounts } from './program-deletion-scope';
import { ProgramErrorCode } from './program-error-code.enum';
import { ProgramPurgeFileCleanupRepository } from './repository/program-purge-file-cleanup.repository';
import { ProgramPurgeFileCleanupService } from './program-purge-file-cleanup.service';
import { ProgramLifecycleService } from './service/program-lifecycle.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const PREFIX = 'test:purge7:';
const OBJECT_PREFIX = 'integration/program-purge-7';
const COVER_OBJECT_PREFIX = 'program-covers/integration-program-purge-7';
const NOW = new Date('2026-08-12T00:00:00.000Z');
const ADMIN_GITHUB_ID = 9_875_000_001n;
const STAFF_GITHUB_ID = 9_875_000_002n;

const STUDENT_GITHUB_ID = 9_875_000_003n;

const prisma = new PrismaService();
const concurrentPrisma = new PrismaService();
const auditLog = new AuditLogService(new AuditLogRepository(prisma));
const lifecycle = new ProgramLifecycleService(prisma, auditLog);
const storageConfig = new SubmissionFileStorageConfig();
const storageSettings = storageConfig.requireSettings();
const s3 = new S3Client({
  endpoint: storageSettings.endpoint,
  region: storageSettings.region,
  forcePathStyle: storageSettings.forcePathStyle,
  credentials: {
    accessKeyId: storageSettings.accessKeyId,
    secretAccessKey: storageSettings.secretAccessKey,
  },
});
const storage = new S3SubmissionFileStorage(storageConfig, s3);

const purgeFileCleanup = new ProgramPurgeFileCleanupService(
  new ProgramPurgeFileCleanupRepository(prisma),
  storage,
);
const publicProjects = new PublicProjectsRepository(prisma);
const submissionFileCleanup = new SubmissionFileCleanupService(
  new SubmissionFilesRepository(prisma),
  storage,
);

type Fixture = {
  readonly programId: string;
  readonly milestoneId: string;
  readonly applicationId: string;
  readonly teamId: string;
  readonly submissionFileStorageKey: string;
  readonly templateFileStorageKey: string;
  readonly coverStorageKey: string;
  readonly externalRepositoryId: string;
  readonly externalGithubRepositoryId: bigint;
  readonly provisionedRepositoryId: string;
  readonly applicationDecisionNotificationId: string;
  readonly applicationDecisionAcknowledgedNotificationId: string;
  readonly deadlineDigestNotificationId: string;
  readonly applicationOutboxEventId: string;
  readonly repositoryIssuanceHistoryId: string;
  readonly repositoryInvitationId: string;
  readonly collectionStreamId: string;
  readonly contributionRepositoryId: string;
  readonly collectionCommitFactId: string;
  readonly collectionPullRequestFactId: string;
  readonly collectionReleaseFactId: string;
  readonly publishedRepositoryId: string;
  readonly publishedGithubRepositoryId: bigint;
};

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({ Bucket: storageSettings.bucket, Key: key }),
    );
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const withMetadata = error as { $metadata?: { httpStatusCode?: unknown } };
  return withMetadata.$metadata?.httpStatusCode === 404;
}

async function cleanup(): Promise<void> {
  const tombstones = await prisma.programPurgeFileTombstone.findMany({
    where: {
      OR: [
        { storageKey: { startsWith: OBJECT_PREFIX } },
        { storageKey: { startsWith: COVER_OBJECT_PREFIX } },
      ],
    },
    select: { storageKey: true },
  });
  await Promise.all(
    tombstones.map(({ storageKey }) => storage.delete(storageKey)),
  );
  await prisma.programPurgeFileTombstone.deleteMany({
    where: {
      OR: [
        { storageKey: { startsWith: OBJECT_PREFIX } },
        { storageKey: { startsWith: COVER_OBJECT_PREFIX } },
      ],
    },
  });
  const covers = await prisma.programCover.findMany({
    where: { programId: { startsWith: PREFIX } },
    select: { storageKey: true },
  });
  await Promise.all(
    covers.flatMap(({ storageKey }) =>
      storageKey === null ? [] : [storage.delete(storageKey)],
    ),
  );
  await prisma.programCover.deleteMany({
    where: { programId: { startsWith: PREFIX } },
  });
  await storage.delete(`${OBJECT_PREFIX}/submission-file.pdf`).catch(() => {});
  await storage.delete(`${OBJECT_PREFIX}/template-file.pdf`).catch(() => {});

  await prisma.milestoneDocumentReviewHistory.deleteMany({
    where: {
      milestoneDocumentSubmission: {
        milestoneDocument: {
          milestone: { program: { id: { startsWith: PREFIX } } },
        },
      },
    },
  });
  await prisma.submissionFile.deleteMany({
    where: {
      OR: [
        { application: { is: { programId: { startsWith: PREFIX } } } },
        { milestone: { is: { programId: { startsWith: PREFIX } } } },
        { storageKey: { startsWith: OBJECT_PREFIX } },
      ],
    },
  });
  await prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: {
      submission: {
        milestoneDocument: {
          milestone: { program: { id: { startsWith: PREFIX } } },
        },
      },
    },
  });
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: {
      milestoneDocument: {
        milestone: { program: { id: { startsWith: PREFIX } } },
      },
    },
  });
  await prisma.milestoneDocumentTemplateFile.deleteMany({
    where: {
      milestoneDocument: {
        milestone: { program: { id: { startsWith: PREFIX } } },
      },
    },
  });
  await prisma.milestoneDocument.deleteMany({
    where: { milestone: { program: { id: { startsWith: PREFIX } } } },
  });
  await prisma.repositoryProvisionJob.deleteMany({
    where: { application: { programId: { startsWith: PREFIX } } },
  });
  await prisma.repositoryIssuanceHistory.deleteMany({
    where: { applicationId: { startsWith: PREFIX } },
  });

  await prisma.repositoryInvitation.deleteMany({
    where: { repository: { nameWithOwner: { startsWith: 'purge7-org/' } } },
  });
  await prisma.githubRepository.deleteMany({
    where: {
      OR: [
        { programId: { startsWith: PREFIX } },
        { application: { is: { programId: { startsWith: PREFIX } } } },
        { nameWithOwner: { startsWith: 'purge7-org/' } },
      ],
    },
  });
  await prisma.boardComment.deleteMany({
    where: { post: { programId: { startsWith: PREFIX } } },
  });
  await prisma.boardPost.deleteMany({
    where: { programId: { startsWith: PREFIX } },
  });
  await prisma.teamInvitation.deleteMany({
    where: { programId: { startsWith: PREFIX } },
  });
  await prisma.teamMember.deleteMany({
    where: { programId: { startsWith: PREFIX } },
  });
  await prisma.application.deleteMany({
    where: { programId: { startsWith: PREFIX } },
  });
  await prisma.team.deleteMany({
    where: { programId: { startsWith: PREFIX } },
  });
  await prisma.programAuthoringUpload.deleteMany({
    where: { actorId: { startsWith: PREFIX } },
  });
  await prisma.programCreateRequest.deleteMany({
    where: { actorId: { startsWith: PREFIX } },
  });
  await prisma.milestone.deleteMany({
    where: { program: { id: { startsWith: PREFIX } } },
  });

  await prisma.outboxEvent.deleteMany({
    where: { aggregateId: { startsWith: PREFIX } },
  });

  await prisma.notification.deleteMany({
    where: { user: { id: { startsWith: PREFIX } } },
  });
  await prisma.program.deleteMany({ where: { id: { startsWith: PREFIX } } });

  await prisma.user.deleteMany({
    where: {
      id: { startsWith: PREFIX },
      NOT: { id: { startsWith: `${PREFIX}global:` } },
    },
  });
}

function labelOrdinal(label: string): bigint {
  return BigInt(
    [...label].reduce((sum, value) => sum + value.charCodeAt(0), 0),
  );
}

async function ensureGlobalActors(): Promise<void> {
  await prisma.user.upsert({
    where: { githubId: ADMIN_GITHUB_ID },
    update: {},
    create: {
      id: `${PREFIX}global:admin`,
      githubId: ADMIN_GITHUB_ID,
      nickname: 'synthetic-purge7-admin',
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  await prisma.user.upsert({
    where: { githubId: STAFF_GITHUB_ID },
    update: {},
    create: {
      id: `${PREFIX}global:staff`,
      githubId: STAFF_GITHUB_ID,
      nickname: 'synthetic-purge7-staff',
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  await prisma.user.upsert({
    where: { githubId: STUDENT_GITHUB_ID },
    update: {},
    create: {
      id: `${PREFIX}global:student`,
      githubId: STUDENT_GITHUB_ID,
      nickname: 'synthetic-purge7-student',
      selectedMemberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
}

async function seedFullChildGraph(
  label: string,
  programLifecycle: ProgramLifecycle = ProgramLifecycle.PUBLISHED,
): Promise<Fixture> {
  const p = (suffix: string) => `${PREFIX}${label}:${suffix}`;
  const ordinal = labelOrdinal(label);
  const programId = p('program');
  const milestoneId = p('milestone');
  const applicantId = p('applicant');
  const leaderId = p('leader');
  const staffId = p('staff-reviewer');
  const teamId = p('team');
  const applicationId = p('application');
  const publishedApplicationId = p('published-application');
  const documentId = p('document');
  const documentSubmissionId = p('document-submission');
  const documentSubmissionHistoryId = p('document-submission-history');
  const boardPostId = p('board-post');
  const boardCommentId = p('board-comment');
  const submissionFileStorageKey = `${OBJECT_PREFIX}/${label}/submission-file.pdf`;
  const templateFileStorageKey = `${OBJECT_PREFIX}/${label}/template-file.pdf`;
  const coverStorageKey = `${COVER_OBJECT_PREFIX}-${label}`;
  const externalRepositoryId = p('external-repo');
  const externalGithubRepositoryId = 9_875_500_000n + ordinal;
  const publishedRepositoryId = p('published-repo');
  const publishedGithubRepositoryId = 9_875_800_000n + ordinal;
  const publishedApplicantId = p('published-applicant');

  await ensureGlobalActors();
  await prisma.user.createMany({
    data: [
      {
        id: applicantId,
        githubId: 9_875_100_000n + ordinal,
        nickname: `synthetic-purge7-applicant-${label}`,
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: leaderId,
        githubId: 9_875_200_000n + ordinal,
        nickname: `synthetic-purge7-leader-${label}`,
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: publishedApplicantId,
        githubId: 9_875_900_000n + ordinal,
        nickname: `synthetic-purge7-published-applicant-${label}`,
        selectedMemberKind: MemberKind.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: staffId,
        githubId: 9_875_300_000n + ordinal,
        nickname: `synthetic-purge7-staff-${label}`,
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        accountStatus: AccountStatus.ACTIVE,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.program.create({
    data: {
      id: programId,
      name: `합성 purge 대상 프로그램 ${label}`,
      organizer: 'Synthetic OSS Center',
      trackType: ProgramTrackType.CURRICULAR,
      category: ProgramCategory.BASIC,
      lifecycle: programLifecycle,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-05T00:00:00.000Z'),
      startAt: new Date('2026-08-06T00:00:00.000Z'),
      endAt: new Date('2026-09-30T00:00:00.000Z'),
      teamMinSize: 1,
      teamMaxSize: 4,
      description: 'Synthetic full child graph fixture',
      repositoryProvisioningEnabled: true,
      cover: {
        create: {
          storageKey: coverStorageKey,
          mimeType: 'image/png',
          sizeBytes: 1,
        },
      },
    },
  });
  await storage.put({
    objectKey: coverStorageKey,
    originalName: 'synthetic-cover.png',
    contentType: 'image/png',
    body: Buffer.from('synthetic-cover'),
  });

  await prisma.milestone.create({
    data: {
      id: milestoneId,
      programId,
      name: `합성 마일스톤 ${label}`,
      startAt: new Date('2026-08-06T00:00:00.000Z'),
      dueAt: new Date('2026-09-01T00:00:00.000Z'),
      submissionType: MilestoneSubmissionType.FILE,
      instructions: 'Synthetic instructions',
    },
  });

  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: `합성 팀 ${label}`,
      joinCodeDigest: `digest:${p('team')}`,
      leaderId,
    },
  });
  await prisma.teamMember.createMany({
    data: [
      { id: p('team-member-leader'), teamId, programId, userId: leaderId },
      {
        id: p('team-member-applicant'),
        teamId,
        programId,
        userId: applicantId,
      },
    ],
  });
  await prisma.teamInvitation.create({
    data: {
      id: p('team-invitation'),
      teamId,
      programId,
      inviteeId: applicantId,
      invitedById: leaderId,
      status: TeamInvitationStatus.ACCEPTED,
      respondedAt: NOW,
    },
  });

  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      applicantId,
      teamId,
      answers: { seedPlaceholder: true, label },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      processedById: staffId,
      processedAt: NOW,
    },
  });

  await prisma.team.create({
    data: {
      id: p('published-team'),
      programId,
      name: `합성 단독 팀 ${label}`,
      joinCodeDigest: `digest:${p('published-team')}`,
      leaderId: publishedApplicantId,
    },
  });
  await prisma.teamMember.create({
    data: {
      id: p('published-team-member-leader'),
      teamId: p('published-team'),
      programId,
      userId: publishedApplicantId,
    },
  });
  await prisma.application.create({
    data: {
      id: publishedApplicationId,
      programId,
      applicantId: publishedApplicantId,
      teamId: p('published-team'),
      answers: { seedPlaceholder: true, label },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      processedById: staffId,
      processedAt: NOW,
    },
  });

  const provisionedRepositoryId = p('provisioned-repo');
  const provisionedGithubRepositoryId = 9_875_400_000n + ordinal;
  await prisma.githubRepository.create({
    data: {
      id: provisionedRepositoryId,
      applicationId,
      programId,
      teamId,
      githubRepositoryId: provisionedGithubRepositoryId,
      nameWithOwner: `purge7-org/${label}-provisioned`,
      source: RepositorySource.ORG_PROVISIONED,
      visibility: RepositoryVisibility.PRIVATE,
    },
  });
  await prisma.repositoryProvisionJob.create({
    data: {
      id: p('provision-job'),
      applicationId,
      repositoryId: provisionedRepositoryId,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      nextAttemptAt: NOW,
      startedAt: NOW,
      finishedAt: NOW,
    },
  });
  const repositoryIssuanceHistoryId = p('repository-issuance-history');
  await prisma.repositoryIssuanceHistory.create({
    data: {
      id: repositoryIssuanceHistoryId,
      requestId: p('repository-issuance-request'),
      applicationId,
      repositoryId: provisionedRepositoryId,
      connectionMode: RepositoryConnectionMode.NEW,
      source: RepositorySource.ORG_PROVISIONED,
      outcome: RepositoryIssuanceOutcome.SUCCEEDED,
      requestedAt: NOW,
      closedAt: NOW,
    },
  });

  const repositoryInvitationId = p('repository-invitation');
  await prisma.repositoryInvitation.create({
    data: {
      id: repositoryInvitationId,
      repositoryId: provisionedRepositoryId,
      githubLogin: `synthetic-purge7-invitee-${label}`,
      status: RepositoryInvitationStatus.SUCCEEDED,
      processedAt: NOW,
    },
  });
  const collectionStreamId = p('collection-stream');
  await prisma.collectionRepositoryStream.create({
    data: {
      id: collectionStreamId,
      repositoryId: provisionedRepositoryId,
      streamType: CollectionStreamType.COMMIT,
      lastRunAt: NOW,
    },
  });
  const contributionRepositoryId = provisionedRepositoryId;
  await prisma.contribution.create({
    data: {
      repositoryId: contributionRepositoryId,
      githubId: 9_875_100_000n + ordinal,
      date: new Date('2026-08-06T00:00:00.000Z'),
      commitCount: 1,
    },
  });
  const collectionCommitFactId = p('collection-commit-fact');
  await prisma.collectionCommitFact.create({
    data: {
      id: collectionCommitFactId,
      repositoryId: provisionedRepositoryId,
      sha: `synthetic-purge7-sha-${label}`,
      committedAt: NOW,
    },
  });
  const collectionPullRequestFactId = p('collection-pull-request-fact');
  await prisma.collectionPullRequestFact.create({
    data: {
      id: collectionPullRequestFactId,
      repositoryId: provisionedRepositoryId,
      githubPullRequestId: 9_875_600_000n + ordinal,
      state: 'MERGED',
      createdAt: NOW,
    },
  });
  const collectionReleaseFactId = p('collection-release-fact');
  await prisma.collectionReleaseFact.create({
    data: {
      id: collectionReleaseFactId,
      repositoryId: provisionedRepositoryId,
      githubReleaseId: 9_875_700_000n + ordinal,
      publishedAt: NOW,
    },
  });

  await prisma.githubRepository.create({
    data: {
      id: externalRepositoryId,
      programId,
      githubRepositoryId: externalGithubRepositoryId,
      nameWithOwner: `purge7-org/${label}-external-public`,
      source: RepositorySource.EXTERNAL_PUBLIC,
      visibility: RepositoryVisibility.PUBLIC,
    },
  });

  await prisma.githubRepository.create({
    data: {
      id: publishedRepositoryId,
      applicationId: publishedApplicationId,
      programId,
      teamId: p('published-team'),
      githubRepositoryId: publishedGithubRepositoryId,
      nameWithOwner: `purge7-org/${label}-published`,
      source: RepositorySource.ORG_PROVISIONED,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: NOW,
    },
  });

  await prisma.boardPost.create({
    data: {
      id: boardPostId,
      programId,
      authorId: staffId,
      category: BoardPostCategory.NOTICE,
      title: 'Synthetic notice',
      body: 'Synthetic body',
    },
  });
  await prisma.boardComment.create({
    data: {
      id: boardCommentId,
      postId: boardPostId,
      authorId: applicantId,
      body: 'Synthetic comment',
    },
  });

  await prisma.milestoneDocument.create({
    data: {
      id: documentId,
      milestoneId,
      name: '합성 서류 항목',
      required: true,
      sortOrder: 1,
      kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
    },
  });
  await storage.put({
    body: Buffer.from('%PDF-template-file'),
    contentType: 'application/pdf',
    originalName: 'template-file.pdf',
    objectKey: templateFileStorageKey,
  });
  await prisma.milestoneDocumentTemplateFile.create({
    data: {
      id: p('template-file'),
      milestoneDocumentId: documentId,
      storageKey: templateFileStorageKey,
      originalFileName: 'template-file.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 18,
      uploadedById: staffId,
    },
  });
  await prisma.milestoneDocumentSubmission.create({
    data: {
      id: documentSubmissionId,
      milestoneDocumentId: documentId,
      applicationId,
      status: SubmissionStatus.CHANGES_REQUESTED,
      content: {},
      revision: 1,
      submittedById: applicantId,
      legacySubmissionId: null,
    },
  });
  await prisma.milestoneDocumentSubmissionHistory.create({
    data: {
      id: documentSubmissionHistoryId,
      milestoneDocumentSubmissionId: documentSubmissionId,
      event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
      revision: 1,
      content: {},
      actorId: applicantId,
    },
  });
  await prisma.milestoneDocumentReviewHistory.create({
    data: {
      id: p('document-review-history'),
      milestoneDocumentSubmissionId: documentSubmissionId,
      submissionHistoryId: documentSubmissionHistoryId,
      reviewerId: staffId,
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: 'Synthetic changes requested',
    },
  });
  await storage.put({
    body: Buffer.from('%PDF-submission-file'),
    contentType: 'application/pdf',
    originalName: 'submission-file.pdf',
    objectKey: submissionFileStorageKey,
  });
  await prisma.submissionFile.create({
    data: {
      id: p('submission-file'),
      uploaderId: applicantId,
      applicationId,
      milestoneId,
      storageKey: submissionFileStorageKey,
      originalFileName: 'submission-file.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 21,
      lifecycle: SubmissionFileLifecycle.ATTACHED,
      milestoneDocumentSubmissionId: documentSubmissionId,
      milestoneDocumentSubmissionHistoryId: documentSubmissionHistoryId,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    },
  });

  const createRequestId = p('create-request');
  await prisma.programCreateRequest.create({
    data: {
      id: createRequestId,
      actorId: staffId,
      idempotencyKey: `idempotency:${label}`,
      payloadHash: createHash('sha256').update(label).digest('hex'),
      programId,
    },
  });
  await prisma.programAuthoringUpload.create({
    data: {
      id: p('authoring-upload'),
      actorId: staffId,
      storageKey: `${OBJECT_PREFIX}/${label}/authoring-upload.pdf`,
      originalFileName: 'authoring-upload.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      sha256: createHash('sha256')
        .update(`${label}-authoring-upload`)
        .digest('hex'),
      lifecycle: ProgramAuthoringUploadLifecycle.ATTACHED,
      attachedAt: NOW,
      createRequestActorId: staffId,
      createRequestId,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    },
  });

  await prisma.outboxEvent.create({
    data: {
      id: p('outbox-event'),
      type: 'PROGRAM_TEST_EVENT',
      aggregateType: 'PROGRAM',
      aggregateId: programId,
      idempotencyKey: p('outbox-idempotency'),
      payload: { seedPlaceholder: true },
    },
  });

  const applicationOutboxEventId = p('application-outbox-event');
  await prisma.outboxEvent.create({
    data: {
      id: applicationOutboxEventId,
      type: 'REPOSITORY_PROVISION_REQUESTED',
      aggregateType: 'Application',
      aggregateId: applicationId,
      idempotencyKey: p('application-outbox-idempotency'),
      payload: { applicationId, programId },
    },
  });

  const applicationDecisionNotificationId = p(
    'application-decision-notification',
  );
  await prisma.notification.create({
    data: {
      id: applicationDecisionNotificationId,
      userId: applicantId,
      type: 'APPLICATION_DECISION',
      channel: 'IN_APP',
      status: 'UNREAD',
      idempotencyKey: p('application-decision-idempotency'),
      payload: {
        schemaVersion: 1,
        applicationId,
        programId,
        programName: `합성 purge 대상 프로그램 ${label}`,
        decision: 'APPROVED',
        decidedAt: NOW.toISOString(),
      },
    },
  });

  const applicationDecisionAcknowledgedNotificationId = p(
    'application-decision-acknowledged-notification',
  );
  await prisma.notification.create({
    data: {
      id: applicationDecisionAcknowledgedNotificationId,
      userId: applicantId,
      type: 'APPLICATION_DECISION_ACKNOWLEDGED',
      channel: 'IN_APP',
      status: 'READ',
      idempotencyKey: `application-decision-acknowledged:${applicationDecisionNotificationId}`,
      payload: {
        schemaVersion: 1,
        notificationId: applicationDecisionNotificationId,
      },
    },
  });

  const deadlineDigestNotificationId = p('deadline-digest-notification');
  await prisma.notification.create({
    data: {
      id: deadlineDigestNotificationId,
      userId: applicantId,
      type: 'DEADLINE_DIGEST',
      channel: 'EMAIL',
      status: 'SENT',
      idempotencyKey: `deadline-digest:2026-08-06:${programId}:${applicantId}`,
      payload: { milestoneCount: 1 },
      sentAt: NOW,
    },
  });

  return {
    programId,
    milestoneId,
    applicationId,
    teamId,
    submissionFileStorageKey,
    templateFileStorageKey,
    coverStorageKey,
    externalRepositoryId,
    externalGithubRepositoryId,
    provisionedRepositoryId,
    applicationDecisionNotificationId,
    applicationDecisionAcknowledgedNotificationId,
    deadlineDigestNotificationId,
    applicationOutboxEventId,
    repositoryIssuanceHistoryId,
    repositoryInvitationId,
    collectionStreamId,
    contributionRepositoryId,
    collectionCommitFactId,
    collectionPullRequestFactId,
    collectionReleaseFactId,
    publishedRepositoryId,
    publishedGithubRepositoryId,
  };
}

async function seedStandaloneProgram(label: string): Promise<string> {
  const programId = `${PREFIX}${label}:program`;
  await prisma.program.create({
    data: {
      id: programId,
      name: `합성 보존 프로그램 ${label}`,
      organizer: 'Synthetic OSS Center',
      trackType: ProgramTrackType.CURRICULAR,
      category: ProgramCategory.BASIC,
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-05T00:00:00.000Z'),
      startAt: new Date('2026-08-06T00:00:00.000Z'),
      endAt: new Date('2026-09-30T00:00:00.000Z'),
      teamMinSize: 1,
      teamMaxSize: 4,
      description: 'Synthetic unrelated program fixture',
      repositoryProvisioningEnabled: false,
    },
  });
  return programId;
}

async function currentDeletionScopeCounts(programId: string) {
  return prisma.$transaction((transaction) =>
    readProgramDeletionScopeCounts(transaction, programId),
  );
}

async function programChildRowCounts(
  programId: string,
  applicationIds: readonly string[] = [],
) {
  const [
    programCovers,
    milestones,
    applications,
    teams,
    teamMembers,
    teamInvitations,
    boardPosts,
    boardComments,
    submissionFilesAttached,
    milestoneDocuments,
    milestoneDocumentTemplateFiles,
    milestoneDocumentSubmissions,
    milestoneDocumentSubmissionHistories,
    milestoneDocumentReviewHistories,
    repositoryProvisionJobs,
    programCreateRequests,
    programAuthoringUploadsAttached,
    programOutboxEvents,
    applicationOutboxEvents,
    programLinkedNotifications,
  ] = await Promise.all([
    prisma.programCover.count({ where: { programId } }),
    prisma.milestone.count({ where: { programId } }),
    prisma.application.count({ where: { programId } }),
    prisma.team.count({ where: { programId } }),
    prisma.teamMember.count({ where: { programId } }),
    prisma.teamInvitation.count({ where: { programId } }),
    prisma.boardPost.count({ where: { programId } }),
    prisma.boardComment.count({ where: { post: { programId } } }),
    prisma.submissionFile.count({
      where: {
        OR: [
          { application: { is: { programId } } },
          { milestone: { is: { programId } } },
          {
            submissionHistory: {
              is: {
                submission: {
                  milestoneDocument: { milestone: { programId } },
                },
              },
            },
          },
        ],
      },
    }),
    prisma.milestoneDocument.count({ where: { milestone: { programId } } }),
    prisma.milestoneDocumentTemplateFile.count({
      where: { milestoneDocument: { milestone: { programId } } },
    }),
    prisma.milestoneDocumentSubmission.count({
      where: { milestoneDocument: { milestone: { programId } } },
    }),
    prisma.milestoneDocumentSubmissionHistory.count({
      where: {
        submission: {
          milestoneDocument: { milestone: { programId } },
        },
      },
    }),
    prisma.milestoneDocumentReviewHistory.count({
      where: {
        milestoneDocumentSubmission: {
          milestoneDocument: { milestone: { programId } },
        },
      },
    }),
    prisma.repositoryProvisionJob.count({
      where: { application: { programId } },
    }),
    prisma.programCreateRequest.count({ where: { programId } }),
    prisma.programAuthoringUpload.count({
      where: { createRequest: { is: { programId } } },
    }),
    prisma.outboxEvent.count({
      where: { aggregateType: 'PROGRAM', aggregateId: programId },
    }),
    applicationIds.length > 0
      ? prisma.outboxEvent.count({
          where: {
            aggregateType: 'Application',
            aggregateId: { in: [...applicationIds] },
          },
        })
      : Promise.resolve(0),
    prisma.notification.count({
      where: {
        OR: [
          {
            type: 'APPLICATION_DECISION',
            payload: { path: ['programId'], equals: programId },
          },
          {
            type: 'DEADLINE_DIGEST',
            idempotencyKey: { contains: `:${programId}:` },
          },
        ],
      },
    }),
  ]);
  return {
    programCovers,
    milestones,
    applications,
    teams,
    teamMembers,
    teamInvitations,
    boardPosts,
    boardComments,
    submissionFilesAttached,
    milestoneDocuments,
    milestoneDocumentTemplateFiles,
    milestoneDocumentSubmissions,
    milestoneDocumentSubmissionHistories,
    milestoneDocumentReviewHistories,
    repositoryProvisionJobs,
    programCreateRequests,
    programAuthoringUploadsAttached,
    outboxEvents: programOutboxEvents + applicationOutboxEvents,
    programLinkedNotifications,
  };
}

const ALL_ZERO = {
  programCovers: 0,
  milestones: 0,
  applications: 0,
  teams: 0,
  teamMembers: 0,
  teamInvitations: 0,
  boardPosts: 0,
  boardComments: 0,
  submissionFilesAttached: 0,
  milestoneDocuments: 0,
  milestoneDocumentTemplateFiles: 0,
  milestoneDocumentSubmissions: 0,
  milestoneDocumentSubmissionHistories: 0,
  milestoneDocumentReviewHistories: 0,
  repositoryProvisionJobs: 0,
  programCreateRequests: 0,
  programAuthoringUploadsAttached: 0,
  outboxEvents: 0,
  programLinkedNotifications: 0,
};

describe('Program purge integration — full child graph, worker file deletion, EXTERNAL_PUBLIC preservation', () => {
  beforeAll(async () => {
    await Promise.all([prisma.$connect(), concurrentPrisma.$connect()]);
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(cleanup);

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    s3.destroy();
    await Promise.all([prisma.$disconnect(), concurrentPrisma.$disconnect()]);
  });

  it('ordinary deletion queues a cover and a failed storage deletion remains retryable', async () => {
    await ensureGlobalActors();
    const programId = `${PREFIX}cover-delete`;
    const storageKey = `${COVER_OBJECT_PREFIX}-cover-delete`;
    await prisma.program.create({
      data: {
        id: programId,
        name: '합성 표지 삭제 프로그램',
        organizer: 'Synthetic OSS Center',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: NOW,
        applicationEndAt: NOW,
        description: 'Synthetic cover cleanup fixture',
        cover: { create: { storageKey, mimeType: 'image/png', sizeBytes: 1 } },
      },
    });
    await storage.put({
      objectKey: storageKey,
      originalName: 'synthetic-cover.png',
      contentType: 'image/png',
      body: Buffer.from('synthetic-cover'),
    });

    await lifecycle.delete(ADMIN_GITHUB_ID, programId);

    await expect(
      prisma.program.findUnique({ where: { id: programId } }),
    ).resolves.toBeNull();
    await expect(
      prisma.programCover.findUnique({ where: { programId } }),
    ).resolves.toBeNull();
    const attemptedAt = new Date();
    const failingCleanup = new ProgramPurgeFileCleanupService(
      new ProgramPurgeFileCleanupRepository(prisma),
      { delete: () => Promise.reject(new Error('synthetic storage failure')) },
      () => attemptedAt,
    );
    await expect(failingCleanup.runDue()).resolves.toBe(1);
    await expect(objectExists(storageKey)).resolves.toBe(true);
    const nextDeleteAttemptAt = new Date(
      attemptedAt.getTime() + 60 * 60 * 1_000,
    );
    await expect(
      prisma.programPurgeFileTombstone.findUnique({ where: { storageKey } }),
    ).resolves.toMatchObject({
      lifecycle: ProgramPurgeFileTombstoneLifecycle.DELETE_PENDING,
      deleteAttemptCount: 1,
      nextDeleteAttemptAt,
    });

    const retryCleanup = new ProgramPurgeFileCleanupService(
      new ProgramPurgeFileCleanupRepository(prisma),
      storage,
      () => nextDeleteAttemptAt,
    );
    await expect(retryCleanup.runDue()).resolves.toBe(1);
    await expect(objectExists(storageKey)).resolves.toBe(false);
    await expect(
      prisma.programPurgeFileTombstone.findUnique({ where: { storageKey } }),
    ).resolves.toMatchObject({
      lifecycle: ProgramPurgeFileTombstoneLifecycle.DELETED,
    });
  });

  it('purges the entire child graph, defers file deletion to the worker, and preserves+detaches EXTERNAL_PUBLIC repositories', async () => {
    const fixture = await seedFullChildGraph(
      'full',
      ProgramLifecycle.PUBLISHED,
    );
    const applicant = await prisma.application.findUniqueOrThrow({
      where: { id: fixture.applicationId },
      select: { applicantId: true },
    });
    const applicantBefore = await prisma.user.findUniqueOrThrow({
      where: { id: applicant.applicantId },
      select: { id: true, githubId: true, accountStatus: true },
    });

    const before = await programChildRowCounts(fixture.programId, [
      fixture.applicationId,
    ]);
    expect(before.milestones).toBe(1);
    expect(before.programCovers).toBe(1);

    expect(before.applications).toBe(2);
    expect(before.milestoneDocumentSubmissions).toBe(1);
    expect(before.milestoneDocumentSubmissionHistories).toBe(1);
    expect(before.milestoneDocumentReviewHistories).toBe(1);
    expect(before.outboxEvents).toBe(2);
    expect(before.programLinkedNotifications).toBe(2);

    await expect(
      prisma.repositoryInvitation.findUnique({
        where: { id: fixture.repositoryInvitationId },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.notification.findUnique({
        where: { id: fixture.applicationDecisionAcknowledgedNotificationId },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.collectionCommitFact.findUnique({
        where: { id: fixture.collectionCommitFactId },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.collectionPullRequestFact.findUnique({
        where: { id: fixture.collectionPullRequestFactId },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.collectionReleaseFact.findUnique({
        where: { id: fixture.collectionReleaseFactId },
      }),
    ).resolves.not.toBeNull();

    const beforePurgePage = await publicProjects.listPage(null, 50);
    expect(
      beforePurgePage.some((row) => row.id === fixture.publishedRepositoryId),
    ).toBe(true);

    const expectedScope = await currentDeletionScopeCounts(fixture.programId);
    const result = await lifecycle.purge(
      ADMIN_GITHUB_ID,
      fixture.programId,
      expectedScope,
    );
    expect(result).toMatchObject({
      id: fixture.programId,
      deleted: true,
      deletedCounts: {
        submissions: 1,
        submissionRevisions: 0,
        reviews: 0,
        submissionFiles: 1,
        milestoneDocumentSubmissions: 1,
        milestoneDocumentSubmissionHistories: 1,
        milestoneDocumentReviewHistories: 1,
        programPurgeFileTombstones: 2,
      },
    });

    const after = await programChildRowCounts(fixture.programId, [
      fixture.applicationId,
    ]);
    expect(after).toEqual(ALL_ZERO);
    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.toBeNull();
    await expect(
      prisma.user.findUnique({
        where: { id: applicant.applicantId },
        select: { id: true, githubId: true, accountStatus: true },
      }),
    ).resolves.toEqual(applicantBefore);

    await expect(
      prisma.notification.findUnique({
        where: { id: fixture.applicationDecisionNotificationId },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.notification.findUnique({
        where: { id: fixture.applicationDecisionAcknowledgedNotificationId },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.notification.findUnique({
        where: { id: fixture.deadlineDigestNotificationId },
      }),
    ).resolves.toBeNull();

    await expect(
      prisma.outboxEvent.findUnique({
        where: { id: fixture.applicationOutboxEventId },
      }),
    ).resolves.toBeNull();

    await expect(
      prisma.repositoryIssuanceHistory.findUnique({
        where: { id: fixture.repositoryIssuanceHistoryId },
      }),
    ).resolves.toMatchObject({
      applicationId: fixture.applicationId,
      outcome: RepositoryIssuanceOutcome.SUCCEEDED,
      repositoryId: fixture.provisionedRepositoryId,
    });

    await expect(
      prisma.repositoryInvitation.findUnique({
        where: { id: fixture.repositoryInvitationId },
      }),
    ).resolves.toMatchObject({ repositoryId: fixture.provisionedRepositoryId });
    await expect(
      prisma.collectionRepositoryStream.findUnique({
        where: { id: fixture.collectionStreamId },
      }),
    ).resolves.toMatchObject({ repositoryId: fixture.provisionedRepositoryId });
    await expect(
      prisma.contribution.findFirst({
        where: { repositoryId: fixture.contributionRepositoryId },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.collectionCommitFact.findUnique({
        where: { id: fixture.collectionCommitFactId },
      }),
    ).resolves.toMatchObject({ repositoryId: fixture.provisionedRepositoryId });
    await expect(
      prisma.collectionPullRequestFact.findUnique({
        where: { id: fixture.collectionPullRequestFactId },
      }),
    ).resolves.toMatchObject({ repositoryId: fixture.provisionedRepositoryId });
    await expect(
      prisma.collectionReleaseFact.findUnique({
        where: { id: fixture.collectionReleaseFactId },
      }),
    ).resolves.toMatchObject({ repositoryId: fixture.provisionedRepositoryId });

    const orphanSubmissionFile = await prisma.submissionFile.findFirst({
      where: { storageKey: fixture.submissionFileStorageKey },
    });
    expect(orphanSubmissionFile).toMatchObject({
      lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
      applicationId: null,
      milestoneId: null,
      milestoneDocumentSubmissionId: null,
      milestoneDocumentSubmissionHistoryId: null,
    });
    expect(await objectExists(fixture.submissionFileStorageKey)).toBe(true);

    const tombstone = await prisma.programPurgeFileTombstone.findUnique({
      where: { storageKey: fixture.templateFileStorageKey },
    });
    expect(tombstone).toMatchObject({
      lifecycle: ProgramPurgeFileTombstoneLifecycle.DELETE_PENDING,
    });
    expect(await objectExists(fixture.templateFileStorageKey)).toBe(true);
    await expect(
      prisma.programPurgeFileTombstone.findUnique({
        where: { storageKey: fixture.coverStorageKey },
      }),
    ).resolves.toMatchObject({
      lifecycle: ProgramPurgeFileTombstoneLifecycle.DELETE_PENDING,
    });
    expect(await objectExists(fixture.coverStorageKey)).toBe(true);

    const submissionFileCleanupClaims = await submissionFileCleanup.runDue();
    expect(submissionFileCleanupClaims).toBeGreaterThanOrEqual(1);
    const templateFileCleanupClaims = await purgeFileCleanup.runDue();
    expect(templateFileCleanupClaims).toBeGreaterThanOrEqual(1);

    expect(await objectExists(fixture.submissionFileStorageKey)).toBe(false);
    expect(await objectExists(fixture.templateFileStorageKey)).toBe(false);
    expect(await objectExists(fixture.coverStorageKey)).toBe(false);
    await expect(
      prisma.programPurgeFileTombstone.findUnique({
        where: { storageKey: fixture.coverStorageKey },
      }),
    ).resolves.toMatchObject({
      lifecycle: ProgramPurgeFileTombstoneLifecycle.DELETED,
    });
    await expect(
      prisma.submissionFile.findFirst({
        where: { storageKey: fixture.submissionFileStorageKey },
      }),
    ).resolves.toMatchObject({ lifecycle: SubmissionFileLifecycle.DELETED });
    await expect(
      prisma.programPurgeFileTombstone.findUnique({
        where: { storageKey: fixture.templateFileStorageKey },
      }),
    ).resolves.toMatchObject({
      lifecycle: ProgramPurgeFileTombstoneLifecycle.DELETED,
    });

    const externalRepository = await prisma.githubRepository.findUnique({
      where: { id: fixture.externalRepositoryId },
    });
    expect(externalRepository).toMatchObject({
      programId: null,
      githubRepositoryId: fixture.externalGithubRepositoryId,
      source: RepositorySource.EXTERNAL_PUBLIC,
    });

    const provisionedRepositories = await prisma.githubRepository.findMany({
      where: { nameWithOwner: { startsWith: 'purge7-org/full-provisioned' } },
    });
    expect(provisionedRepositories).toHaveLength(1);
    expect(provisionedRepositories[0]).toMatchObject({
      programId: null,
      applicationId: null,
      teamId: null,
      source: RepositorySource.ORG_PROVISIONED,
    });

    const publishedRepositoryAfter = await prisma.githubRepository.findUnique({
      where: { id: fixture.publishedRepositoryId },
    });
    expect(publishedRepositoryAfter).toMatchObject({
      programId: null,
      applicationId: null,
      teamId: null,
      publishedAt: null,
      visibility: RepositoryVisibility.PUBLIC,
      githubRepositoryId: fixture.publishedGithubRepositoryId,
    });

    const afterPurgePage = await publicProjects.listPage(null, 50);
    expect(
      afterPurgePage.some((row) => row.id === fixture.publishedRepositoryId),
    ).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { targetType: 'PROGRAM', targetId: fixture.programId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.action).toBe('PROGRAM_DELETED');
  });

  it('purges a populated ARCHIVED program while preserving its account and unrelated programs', async () => {
    const fixture = await seedFullChildGraph(
      'archived',
      ProgramLifecycle.ARCHIVED,
    );
    const unrelatedProgramId = await seedStandaloneProgram('unrelated');
    const applicant = await prisma.application.findUniqueOrThrow({
      where: { id: fixture.applicationId },
      select: { applicantId: true },
    });
    const accountBefore = await prisma.user.findUniqueOrThrow({
      where: { id: applicant.applicantId },
      select: { id: true, githubId: true, accountStatus: true },
    });

    await expect(
      prisma.program.findUnique({
        where: { id: fixture.programId },
        select: { lifecycle: true },
      }),
    ).resolves.toEqual({ lifecycle: ProgramLifecycle.ARCHIVED });

    const expectedScope = await currentDeletionScopeCounts(fixture.programId);
    expect(expectedScope).toMatchObject({
      applications: 2,
      teams: 2,
      boardPosts: 1,
      submissions: 1,
      submissionEvents: 3,
    });
    await expect(
      lifecycle.purge(ADMIN_GITHUB_ID, fixture.programId, expectedScope),
    ).resolves.toMatchObject({
      id: fixture.programId,
      deleted: true,
      deletedCounts: {
        applications: 2,
        teams: 2,
        boardPosts: 1,
        submissions: 1,
        submissionFiles: 1,
      },
    });

    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.toBeNull();
    await expect(
      prisma.user.findUnique({
        where: { id: applicant.applicantId },
        select: { id: true, githubId: true, accountStatus: true },
      }),
    ).resolves.toEqual(accountBefore);
    await expect(
      prisma.program.findUnique({
        where: { id: unrelatedProgramId },
        select: { id: true, lifecycle: true },
      }),
    ).resolves.toEqual({
      id: unrelatedProgramId,
      lifecycle: ProgramLifecycle.PUBLISHED,
    });
    const audit = await prisma.auditLog.findFirst({
      where: { targetType: 'PROGRAM', targetId: fixture.programId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.action).toBe('PROGRAM_DELETED');
    expect(audit?.metadata).toMatchObject({
      lifecycle: ProgramLifecycle.ARCHIVED,
    });
  });

  it('이미 삭제 완료된 SubmissionFile은 완료 상태를 보존한 채 FK만 분리하고 purge한다', async () => {
    const fixture = await seedFullChildGraph('deleted-submission-file');
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: fixture.applicationId },
      select: { applicantId: true },
    });
    const submission =
      await prisma.milestoneDocumentSubmission.findFirstOrThrow({
        where: { applicationId: fixture.applicationId },
        select: { id: true },
      });
    const history =
      await prisma.milestoneDocumentSubmissionHistory.findFirstOrThrow({
        where: { milestoneDocumentSubmissionId: submission.id },
        select: { id: true },
      });
    const deletedFileId = `${fixture.programId}-deleted-submission-file`;
    const deletedAt = new Date('2026-08-13T00:00:00.000Z');
    await prisma.submissionFile.create({
      data: {
        id: deletedFileId,
        uploaderId: application.applicantId,
        applicationId: fixture.applicationId,
        milestoneId: fixture.milestoneId,
        milestoneDocumentSubmissionId: submission.id,
        milestoneDocumentSubmissionHistoryId: history.id,
        storageKey: `${OBJECT_PREFIX}/deleted-submission-file/completed.pdf`,
        originalFileName: 'completed.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 21,
        lifecycle: SubmissionFileLifecycle.DELETED,
        deletedAt,
      },
    });

    const expectedScope = await currentDeletionScopeCounts(fixture.programId);
    await expect(
      lifecycle.purge(ADMIN_GITHUB_ID, fixture.programId, expectedScope),
    ).resolves.toMatchObject({
      id: fixture.programId,
      deleted: true,
      deletedCounts: { submissionFiles: 2 },
    });

    await expect(
      prisma.submissionFile.findUnique({ where: { id: deletedFileId } }),
    ).resolves.toMatchObject({
      lifecycle: SubmissionFileLifecycle.DELETED,
      deletedAt,
      applicationId: null,
      milestoneId: null,
      milestoneDocumentSubmissionId: null,
      milestoneDocumentSubmissionHistoryId: null,
    });
  });

  it('STAFF가 purge하면 실제로 지워지고 감사 로그의 행위자가 그 교직원이다', async () => {
    const fixture = await seedFullChildGraph('staff-allowed');
    const expectedScope = await currentDeletionScopeCounts(fixture.programId);

    const result = await lifecycle.purge(
      STAFF_GITHUB_ID,
      fixture.programId,
      expectedScope,
    );
    expect(result).toMatchObject({ id: fixture.programId, deleted: true });

    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.toBeNull();

    const staff = await prisma.user.findUniqueOrThrow({
      where: { githubId: STAFF_GITHUB_ID },
      select: { id: true },
    });
    const audit = await prisma.auditLog.findFirst({
      where: { targetType: 'PROGRAM', targetId: fixture.programId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.action).toBe('PROGRAM_DELETED');
    expect(audit?.actorId).toBe(staff.id);
  });

  it('STAFF의 purge도 확인 후 자식 행이 생기면 409 PRG_014로 중단하고 아무것도 지우지 않는다', async () => {
    const fixture = await seedFullChildGraph('staff-toctou-race');
    const expectedScope = await currentDeletionScopeCounts(fixture.programId);

    const raceBoardPostId = `${fixture.programId}-staff-race-board-post`;
    const applicant = await prisma.application.findUniqueOrThrow({
      where: { id: fixture.applicationId },
      select: { applicantId: true },
    });
    await prisma.boardPost.create({
      data: {
        id: raceBoardPostId,
        programId: fixture.programId,
        authorId: applicant.applicantId,
        category: BoardPostCategory.NOTICE,
        title: 'Race-inserted notice (staff)',
        body: 'Inserted after scope confirmation, before staff purge',
      },
    });

    await expect(
      lifecycle.purge(STAFF_GITHUB_ID, fixture.programId, expectedScope),
    ).rejects.toBeInstanceOf(DomainException);
    await expect(
      lifecycle.purge(STAFF_GITHUB_ID, fixture.programId, expectedScope),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED },
    });

    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.not.toBeNull();
    const after = await programChildRowCounts(fixture.programId, [
      fixture.applicationId,
    ]);
    expect(after.milestones).toBe(1);
    expect(after.applications).toBe(2);
    expect(after.boardPosts).toBe(2);
  });

  it('STAFF의 일반 삭제도 자식 데이터가 있으면 409 PRG_012로 막힌다', async () => {
    const fixture = await seedFullChildGraph('staff-blocked');

    await expect(
      lifecycle.delete(STAFF_GITHUB_ID, fixture.programId),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_DELETE_BLOCKED },
      extensions: {
        blockingCounts: expect.objectContaining({ applications: 2 }) as unknown,
      },
    });
    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.not.toBeNull();
  });

  it('학생은 delete·purge 모두 403 PRG_011을 받고 프로그램은 그대로 남는다', async () => {
    const fixture = await seedFullChildGraph('student-forbidden');
    const expectedScope = await currentDeletionScopeCounts(fixture.programId);

    await expect(
      lifecycle.delete(STUDENT_GITHUB_ID, fixture.programId),
    ).rejects.toBeInstanceOf(DomainException);
    await expect(
      lifecycle.delete(STUDENT_GITHUB_ID, fixture.programId),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN },
    });
    await expect(
      lifecycle.purge(STUDENT_GITHUB_ID, fixture.programId, expectedScope),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN },
    });

    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.not.toBeNull();
    const after = await programChildRowCounts(fixture.programId, [
      fixture.applicationId,
    ]);
    expect(after.milestones).toBe(1);
    expect(after.applications).toBe(2);
  });

  it('stale_state: purge 이후 같은 프로그램에 대한 기존 가드 delete는 정지된 blockingCounts가 아니라 PROGRAM_NOT_FOUND를 던진다', async () => {
    const fixture = await seedFullChildGraph('stale-state');

    await expect(
      lifecycle.delete(ADMIN_GITHUB_ID, fixture.programId),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_DELETE_BLOCKED },
      extensions: {
        blockingCounts: expect.objectContaining({ applications: 2 }) as unknown,
      },
    });

    const staleStateExpectedScope = await currentDeletionScopeCounts(
      fixture.programId,
    );
    await lifecycle.purge(
      ADMIN_GITHUB_ID,
      fixture.programId,
      staleStateExpectedScope,
    );

    await expect(
      lifecycle.delete(ADMIN_GITHUB_ID, fixture.programId),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_NOT_FOUND },
    });
    await expect(
      lifecycle.purge(
        ADMIN_GITHUB_ID,
        fixture.programId,
        staleStateExpectedScope,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_NOT_FOUND },
    });
  });

  it('atomicity: 트랜잭션 중간에 실패를 유도하면 전부 롤백되고 부분 삭제가 남지 않는다', async () => {
    const fixture = await seedFullChildGraph('atomic-rollback');
    const before = await programChildRowCounts(fixture.programId, [
      fixture.applicationId,
    ]);
    expect(before.milestones).toBe(1);
    expect(before.milestoneDocumentReviewHistories).toBe(1);

    const failingAuditLog = {
      record: jest.fn().mockRejectedValue(new Error('induced audit failure')),
    } as unknown as AuditLogService;
    const failingLifecycle = new ProgramLifecycleService(
      prisma,
      failingAuditLog,
    );
    const expectedScope = await currentDeletionScopeCounts(fixture.programId);

    await expect(
      failingLifecycle.purge(ADMIN_GITHUB_ID, fixture.programId, expectedScope),
    ).rejects.toThrow('induced audit failure');

    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.not.toBeNull();
    const after = await programChildRowCounts(fixture.programId, [
      fixture.applicationId,
    ]);
    expect(after).toEqual(before);
    await expect(
      prisma.programPurgeFileTombstone.findUnique({
        where: { storageKey: fixture.coverStorageKey },
      }),
    ).resolves.toBeNull();
    expect(await objectExists(fixture.coverStorageKey)).toBe(true);
    const submissionFile = await prisma.submissionFile.findFirst({
      where: { storageKey: fixture.submissionFileStorageKey },
    });
    expect(submissionFile).toMatchObject({
      lifecycle: SubmissionFileLifecycle.ATTACHED,
    });
    const externalRepository = await prisma.githubRepository.findUnique({
      where: { id: fixture.externalRepositoryId },
    });
    expect(externalRepository?.programId).toBe(fixture.programId);
  });

  it('전체 삭제는 연결된 프로그램 트리를 삭제한다', async () => {
    const fixture = await seedFullChildGraph('unprotected');

    const expectedScope = await currentDeletionScopeCounts(fixture.programId);
    const result = await lifecycle.purge(
      ADMIN_GITHUB_ID,
      fixture.programId,
      expectedScope,
    );
    expect(result).toMatchObject({ id: fixture.programId, deleted: true });
    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.toBeNull();
  });

  it('race: 확인 후·purge 전에 생긴 자식 행이 있으면 409 PRG_014로 거부하고 아무것도 지우지 않는다', async () => {
    const fixture = await seedFullChildGraph('toctou-race');

    const expectedScope = await currentDeletionScopeCounts(fixture.programId);
    expect(expectedScope).toMatchObject({
      applications: 2,
      teams: 2,
      boardPosts: 1,
      submissions: 1,
      submissionEvents: 3,
    });
    expect(expectedScope.scopeFingerprint).toMatch(/^[0-9a-f]{32}$/);

    const raceBoardPostId = `${fixture.programId}-race-board-post`;
    const applicant = await prisma.application.findUniqueOrThrow({
      where: { id: fixture.applicationId },
      select: { applicantId: true },
    });
    await prisma.boardPost.create({
      data: {
        id: raceBoardPostId,
        programId: fixture.programId,
        authorId: applicant.applicantId,
        category: BoardPostCategory.NOTICE,
        title: 'Race-inserted notice',
        body: 'Inserted after scope confirmation, before purge',
      },
    });

    await expect(
      lifecycle.purge(ADMIN_GITHUB_ID, fixture.programId, expectedScope),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED },
      extensions: {
        currentScopeCounts: {
          applications: 2,
          teams: 2,
          boardPosts: 2,
          submissions: 1,
        },
      },
    });

    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.boardPost.findUnique({ where: { id: raceBoardPostId } }),
    ).resolves.not.toBeNull();
    const after = await programChildRowCounts(fixture.programId, [
      fixture.applicationId,
    ]);
    expect(after.milestones).toBe(1);
    expect(after.applications).toBe(2);
    expect(after.teams).toBe(2);
    expect(after.boardPosts).toBe(2);
    expect(after.milestoneDocumentSubmissions).toBe(1);
  });

  it('race: 확인 뒤 추가된 댓글은 요약 건수가 같아도 지문 변경으로 삭제를 중단한다', async () => {
    const fixture = await seedFullChildGraph('toctou-comment-race');
    const expectedScope = await currentDeletionScopeCounts(fixture.programId);
    const post = await prisma.boardPost.findFirstOrThrow({
      where: { programId: fixture.programId },
      select: { id: true, authorId: true },
    });
    const commentId = `${fixture.programId}-race-comment`;
    await prisma.boardComment.create({
      data: {
        id: commentId,
        postId: post.id,
        authorId: post.authorId,
        body: '확인 화면 이후에 추가된 댓글',
      },
    });

    await expect(
      lifecycle.purge(ADMIN_GITHUB_ID, fixture.programId, expectedScope),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED },
      extensions: {
        currentScopeCounts: {
          applications: expectedScope.applications,
          teams: expectedScope.teams,
          boardPosts: expectedScope.boardPosts,
          submissions: expectedScope.submissions,
          submissionEvents: expectedScope.submissionEvents,
        },
      },
    });
    await expect(
      prisma.boardComment.findUnique({ where: { id: commentId } }),
    ).resolves.not.toBeNull();
  });

  const IN_TRANSACTION_RACE_CASES: readonly {
    readonly scopeField:
      'applications' | 'teams' | 'boardPosts' | 'submissions';
    readonly insertRacingChildRow: (
      fixture: Fixture,
      raceId: string,
    ) => Promise<void>;
  }[] = [
    {
      scopeField: 'boardPosts',
      insertRacingChildRow: async (fixture, raceId) => {
        const applicant = await prisma.application.findUniqueOrThrow({
          where: { id: fixture.applicationId },
          select: { applicantId: true },
        });
        await concurrentPrisma.boardPost.create({
          data: {
            id: raceId,
            programId: fixture.programId,
            authorId: applicant.applicantId,
            category: BoardPostCategory.NOTICE,
            title: 'Committed during purge',
            body: 'Inserted after purge scope read, before destructive writes',
          },
        });
      },
    },
    {
      scopeField: 'teams',
      insertRacingChildRow: async (fixture, raceId) => {
        const applicant = await prisma.application.findUniqueOrThrow({
          where: { id: fixture.applicationId },
          select: { applicantId: true },
        });
        await concurrentPrisma.team.create({
          data: {
            id: raceId,
            programId: fixture.programId,
            name: 'Committed team during purge',
            joinCodeDigest: `digest:${raceId}`,
            leaderId: applicant.applicantId,
          },
        });
      },
    },
    {
      scopeField: 'applications',
      insertRacingChildRow: async (fixture, raceId) => {
        const applicant = await prisma.application.findUniqueOrThrow({
          where: { id: fixture.applicationId },
          select: { applicantId: true },
        });
        const raceTeamId = `${raceId}-team`;
        await concurrentPrisma.team.create({
          data: {
            id: raceTeamId,
            programId: fixture.programId,
            name: 'Committed application team during purge',
            joinCodeDigest: `digest:${raceTeamId}`,
            leaderId: applicant.applicantId,
          },
        });
        await concurrentPrisma.application.create({
          data: {
            id: raceId,
            programId: fixture.programId,
            applicantId: applicant.applicantId,
            teamId: raceTeamId,
            answers: { racedDuringPurge: true },
            applicationTemplateVersion: 1,
            status: ApplicationStatus.SUBMITTED,
          },
        });
      },
    },
    {
      scopeField: 'submissions',
      insertRacingChildRow: async (fixture, raceId) => {
        const raceDocumentId = `${raceId}-document`;
        await concurrentPrisma.milestoneDocument.create({
          data: {
            id: raceDocumentId,
            milestoneId: fixture.milestoneId,
            name: 'Committed target document during purge',
            required: true,
            sortOrder: 2,
            kind: MilestoneDocumentKind.DOCUMENT,
          },
        });
        await concurrentPrisma.milestoneDocumentSubmission.create({
          data: {
            id: raceId,
            legacySubmissionId: null,
            milestoneDocumentId: raceDocumentId,
            applicationId: fixture.applicationId,
            status: SubmissionStatus.SUBMITTED,
            revision: 1,
            submittedById: (
              await prisma.application.findUniqueOrThrow({
                where: { id: fixture.applicationId },
                select: { applicantId: true },
              })
            ).applicantId,
          },
        });
      },
    },
  ];

  it.each(IN_TRANSACTION_RACE_CASES)(
    'race: in-transaction 범위 재확인 뒤 커밋된 $scopeField는 409 PRG_014로 보존한다',
    async ({ scopeField, insertRacingChildRow }) => {
      const fixture = await seedFullChildGraph(`in-tx-race-${scopeField}`);
      const before = await programChildRowCounts(fixture.programId, [
        fixture.applicationId,
      ]);
      const expectedScope = await currentDeletionScopeCounts(fixture.programId);
      const scopeRead = deferred();
      const resumePurge = deferred();
      let requestedOptions: InteractiveTransactionOptions | undefined;
      const pausingLifecycle = new ProgramLifecycleService(
        pausingScopeReadPrisma(
          async () => {
            scopeRead.resolve();
            await resumePurge.promise;
          },
          (options) => {
            requestedOptions = options;
          },
        ),
        auditLog,
      );
      const raceRowId = `${fixture.programId}-in-tx-race-${scopeField}`;

      const purge = pausingLifecycle.purge(
        ADMIN_GITHUB_ID,
        fixture.programId,
        expectedScope,
      );
      await scopeRead.promise;
      try {
        await insertRacingChildRow(fixture, raceRowId);
      } finally {
        resumePurge.resolve();
      }

      const expectedCurrentScopeCounts =
        scopeField === 'applications'
          ? {
              applications: expectedScope.applications + 1,
              teams: expectedScope.teams + 1,
              boardPosts: expectedScope.boardPosts,
              submissions: expectedScope.submissions,
              submissionEvents: expectedScope.submissionEvents,
            }
          : {
              applications: expectedScope.applications,
              teams: expectedScope.teams,
              boardPosts: expectedScope.boardPosts,
              submissions: expectedScope.submissions,
              submissionEvents: expectedScope.submissionEvents,
              [scopeField]: expectedScope[scopeField] + 1,
            };
      await expect(purge).rejects.toMatchObject({
        errorCode: { code: ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED },
        extensions: { currentScopeCounts: expectedCurrentScopeCounts },
      });
      expect(requestedOptions).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      const after = await programChildRowCounts(fixture.programId, [
        fixture.applicationId,
      ]);
      const expectedAfter = { ...before };
      if (scopeField === 'boardPosts') {
        expectedAfter.boardPosts = before.boardPosts + 1;
      } else if (scopeField === 'teams') {
        expectedAfter.teams = before.teams + 1;
      } else if (scopeField === 'applications') {
        expectedAfter.applications = before.applications + 1;
        expectedAfter.teams = before.teams + 1;
      } else {
        expectedAfter.milestoneDocumentSubmissions =
          before.milestoneDocumentSubmissions + 1;
        expectedAfter.milestoneDocuments = before.milestoneDocuments + 1;
      }
      expect(after).toEqual(expectedAfter);
      await expect(
        prisma.program.findUnique({ where: { id: fixture.programId } }),
      ).resolves.not.toBeNull();
    },
  );

  it('purge는 클라이언트가 보낸 expectedScope가 현재 범위와 일치하면 성공한다', async () => {
    const fixture = await seedFullChildGraph('scope-matches');
    const expectedScope = await currentDeletionScopeCounts(fixture.programId);

    const result = await lifecycle.purge(
      ADMIN_GITHUB_ID,
      fixture.programId,
      expectedScope,
    );

    expect(result).toMatchObject({ id: fixture.programId, deleted: true });
    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.toBeNull();
  });
});

type InteractiveTransactionOptions = {
  readonly maxWait?: number;
  readonly timeout?: number;
  readonly isolationLevel?: Prisma.TransactionIsolationLevel;
};

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve: () => resolve() };
}

function pausingScopeReadPrisma(
  onScopeRead: () => Promise<void>,
  captureOptions: (options: InteractiveTransactionOptions | undefined) => void,
): PrismaService {
  let scopeReadPaused = false;
  let transactionOptionsCaptured = false;
  return new Proxy(prisma, {
    get(target, property, receiver): unknown {
      if (property !== '$transaction') {
        return Reflect.get(target, property, receiver);
      }
      return <T>(
        operation: (client: Prisma.TransactionClient) => Promise<T>,
        options?: InteractiveTransactionOptions,
      ): Promise<T> => {
        if (!transactionOptionsCaptured) {
          transactionOptionsCaptured = true;
          captureOptions(options);
        }
        return prisma.$transaction(async (transaction) => {
          const pausingTransaction = new Proxy(transaction, {
            get(
              transactionTarget,
              transactionProperty,
              transactionReceiver,
            ): unknown {
              if (transactionProperty !== '$queryRaw') {
                return Reflect.get(
                  transactionTarget,
                  transactionProperty,
                  transactionReceiver,
                );
              }
              const rawQuery =
                transactionTarget.$queryRaw.bind(transactionTarget);
              return async (...args: Parameters<typeof rawQuery>) => {
                const result = await rawQuery(...args);
                if (!scopeReadPaused) {
                  scopeReadPaused = true;
                  await onScopeRead();
                }
                return result;
              };
            },
          });
          return operation(pausingTransaction);
        }, options);
      };
    },
  });
}
