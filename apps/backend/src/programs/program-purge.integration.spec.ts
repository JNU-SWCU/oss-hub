import { FileCleanupRepository } from './files.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import {
  ProgramsRepository,
  ProgramDeletionScopeRepository,
  ProgramLifecycleRepository,
  ProgramListStatusFilterRepository,
  ProgramHistoryRepository,
} from './programs.repository';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { createHash } from 'node:crypto';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  AccountStatus,
  ApplicationStatus,
  BoardPostCategory,
  SubmissionHistoryEvent,
  Prisma,
  FileLifecycle,
  ProgramCategory,
  ProgramLifecycle,
  RepositoryInvitationStatus,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  SubmissionStatus,
  TeamHistoryEvent,
  HistorySource,
  ProgramTrackType,
} from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import { S3ObjectStorageClient } from '../platform/s3-object-storage.client';
import { FileCleanupService } from './file-cleanup.service';
import { ObjectStorageConfig } from '../platform/object-storage.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  repositoryContributionTotals,
  seedDailyContributions,
} from '../../test/ledger-contribution.fixture';
import { PublicProjectsRepository } from './public-projects.repository';
import { ProgramErrorCode } from './programs.error';
import { ProgramLifecycleService } from './programs.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const DATABASE_CONNECTION_TIMEOUT_MS = 60000;
const PREFIX = 'test:purge7:';
const OBJECT_PREFIX = 'integration/program-purge-7';
const COVER_OBJECT_PREFIX = 'program-covers/integration-program-purge-7';
const NOW = new Date('2026-08-12T00:00:00.000Z');
const ADMIN_GITHUB_ID = 9875000001n;
const STAFF_GITHUB_ID = 9875000002n;
const STUDENT_GITHUB_ID = 9875000003n;
const prisma = new PrismaService();
const concurrentPrisma = new PrismaService();
const programHistory = new ProgramHistoryRepository();
const lifecycle = new ProgramLifecycleService(
  new ProgramLifecycleRepository(prisma, new ProgramDeletionScopeRepository()),
  programHistory,
  new HistoryMetadataService(),
  new PrismaSerializationRetryRepository(),
);
const storageConfig = new ObjectStorageConfig();
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
const storage = new S3ObjectStorageClient(storageConfig, s3);
const purgeFileCleanup = new FileCleanupService(
  new FileCleanupRepository(prisma),
  storage,
);
const publicProjects = new PublicProjectsRepository(prisma);
const submissionFileCleanup = new FileCleanupService(
  new FileCleanupRepository(prisma),
  storage,
);
type Fixture = {
  readonly programId: string;
  readonly milestoneId: string;
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
  const withMetadata = error as {
    $metadata?: {
      httpStatusCode?: unknown;
    };
  };
  return withMetadata.$metadata?.httpStatusCode === 404;
}
async function cleanup(): Promise<void> {
  await prisma.program.updateMany({
    where: { id: { startsWith: PREFIX } },
    data: { coverFileId: null },
  });
  await prisma.teamHistory.deleteMany({
    where: { programId: { startsWith: PREFIX } },
  });
  const tombstones = await prisma.file.findMany({
    where: {
      kind: 'UPLOAD',
      OR: [
        { kind: 'UPLOAD', storageKey: { startsWith: OBJECT_PREFIX } },
        { kind: 'UPLOAD', storageKey: { startsWith: COVER_OBJECT_PREFIX } },
      ],
    },
    select: { storageKey: true },
  });
  await Promise.all(
    tombstones.map(({ storageKey }) => storage.delete(storageKey)),
  );
  await prisma.file.deleteMany({
    where: {
      kind: 'UPLOAD',
      OR: [
        { kind: 'UPLOAD', storageKey: { startsWith: OBJECT_PREFIX } },
        { kind: 'UPLOAD', storageKey: { startsWith: COVER_OBJECT_PREFIX } },
      ],
    },
  });
  const covers = await prisma.file.findMany({
    where: { kind: 'COVER', programId: { startsWith: PREFIX } },
    select: { storageKey: true },
  });
  await Promise.all(
    covers.flatMap(({ storageKey }) =>
      storageKey === null ? [] : [storage.delete(storageKey)],
    ),
  );
  await prisma.file.deleteMany({
    where: { kind: 'COVER', programId: { startsWith: PREFIX } },
  });
  await storage.delete(`${OBJECT_PREFIX}/submission-file.pdf`).catch(() => {});
  await storage.delete(`${OBJECT_PREFIX}/template-file.pdf`).catch(() => {});
  await prisma.file.deleteMany({
    where: {
      kind: 'SUBMISSION',
      OR: [
        {
          kind: 'SUBMISSION',
          team: { is: { programId: { startsWith: PREFIX } } },
        },
        {
          kind: 'SUBMISSION',
          requirement: {
            milestone: { is: { programId: { startsWith: PREFIX } } },
          },
        },
        { kind: 'SUBMISSION', storageKey: { startsWith: OBJECT_PREFIX } },
      ],
    },
  });
  await prisma.submissionHistory.deleteMany({
    where: {
      submission: {
        requirement: {
          milestone: { program: { id: { startsWith: PREFIX } } },
        },
      },
    },
  });
  await prisma.submission.deleteMany({
    where: {
      requirement: {
        milestone: { program: { id: { startsWith: PREFIX } } },
      },
    },
  });
  await prisma.file.deleteMany({
    where: {
      kind: 'TEMPLATE',
      requirement: {
        milestone: { program: { id: { startsWith: PREFIX } } },
      },
    },
  });
  await prisma.requirement.deleteMany({
    where: { milestone: { program: { id: { startsWith: PREFIX } } } },
  });
  await prisma.repositoryProvisionJob.deleteMany({
    where: { team: { programId: { startsWith: PREFIX } } },
  });
  await prisma.repositoryIssuanceHistory.deleteMany({
    where: { teamId: { startsWith: PREFIX } },
  });
  await prisma.repositoryInvitation.deleteMany({
    where: { repository: { nameWithOwner: { startsWith: 'purge7-org/' } } },
  });
  await prisma.githubRepository.deleteMany({
    where: {
      OR: [
        { team: { is: { programId: { startsWith: PREFIX } } } },
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
  await prisma.team.deleteMany({
    where: { programId: { startsWith: PREFIX } },
  });
  await prisma.file.deleteMany({
    where: { kind: 'UPLOAD', uploaderId: { startsWith: PREFIX } },
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
  await prisma.admin.deleteMany({
    where: {
      user: {
        id: { startsWith: PREFIX },
        NOT: { id: { startsWith: `${PREFIX}global:` } },
      },
    },
  });
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
      accountStatus: AccountStatus.ACTIVE,
      ...{ admin: { create: { origin: 'MIGRATION' as const } } },
    },
  });
  await prisma.user.upsert({
    where: { githubId: STAFF_GITHUB_ID },
    update: {},
    create: {
      id: `${PREFIX}global:staff`,
      githubId: STAFF_GITHUB_ID,
      nickname: 'synthetic-purge7-staff',
      accountStatus: AccountStatus.ACTIVE,
      type: MemberKind.STAFF,
      approvalStatus: 'APPROVED',
      name: 'Synthetic staff',
      department: 'Synthetic department',
      profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      departmentType: 'DEPARTMENT',
    },
  });
  await prisma.user.upsert({
    where: { githubId: STUDENT_GITHUB_ID },
    update: {},
    create: {
      id: `${PREFIX}global:student`,
      githubId: STUDENT_GITHUB_ID,
      nickname: 'synthetic-purge7-student',
      accountStatus: AccountStatus.ACTIVE,
      type: MemberKind.STUDENT,
      approvalStatus: 'NOT_REQUIRED',
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
  const documentId = p('document');
  const documentSubmissionId = p('document-submission');
  const documentSubmissionHistoryId = p('document-submission-history');
  const boardPostId = p('board-post');
  const boardCommentId = p('board-comment');
  const submissionFileStorageKey = `${OBJECT_PREFIX}/${label}/submission-file.pdf`;
  const templateFileStorageKey = `${OBJECT_PREFIX}/${label}/template-file.pdf`;
  const coverStorageKey = `${COVER_OBJECT_PREFIX}-${label}`;
  const externalRepositoryId = p('external-repo');
  const externalGithubRepositoryId = 9875500000n + ordinal;
  const publishedRepositoryId = p('published-repo');
  const publishedGithubRepositoryId = 9875800000n + ordinal;
  const publishedApplicantId = p('published-applicant');
  await ensureGlobalActors();
  await prisma.user.createMany({
    data: [
      {
        id: applicantId,
        githubId: 9875100000n + ordinal,
        nickname: `synthetic-purge7-applicant-${label}`,
        accountStatus: AccountStatus.ACTIVE,
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
      {
        id: leaderId,
        githubId: 9875200000n + ordinal,
        nickname: `synthetic-purge7-leader-${label}`,
        accountStatus: AccountStatus.ACTIVE,
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
      {
        id: publishedApplicantId,
        githubId: 9875900000n + ordinal,
        nickname: `synthetic-purge7-published-applicant-${label}`,
        accountStatus: AccountStatus.ACTIVE,
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
      {
        id: staffId,
        githubId: 9875300000n + ordinal,
        nickname: `synthetic-purge7-staff-${label}`,
        accountStatus: AccountStatus.ACTIVE,
        type: MemberKind.STAFF,
        approvalStatus: 'APPROVED',
        name: 'Synthetic staff',
        department: 'Synthetic department',
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        departmentType: 'DEPARTMENT',
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
    },
  });
  await createOwnedCover(programId, coverStorageKey);
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
      instructions: 'Synthetic instructions',
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: `합성 팀 ${label}`,
      leaderId,
      applicantId: leaderId,
      answers: { title: `합성 팀 ${label}` },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.createMany({
    data: [
      { teamId, programId, userId: leaderId },
      {
        teamId,
        programId,
        userId: applicantId,
      },
    ],
  });
  await prisma.teamHistory.create({
    data: {
      id: p('team-invitation-history'),
      teamId,
      programId,
      actorId: applicantId,
      event: TeamHistoryEvent.INVITATION_ACCEPTED,
      source: HistorySource.APPLICATION,
      sourceTable: 'TeamInvitation',
      sourceId: p('team-invitation'),
      occurredAt: NOW,
      data: {
        schemaVersion: 1,
        invitation: {
          id: p('team-invitation'),
          inviteeId: applicantId,
          invitedById: leaderId,
          createdAt: NOW.toISOString(),
        },
      },
    },
  });
  await prisma.teamInvitation.create({
    data: {
      id: p('pending-team-invitation'),
      teamId,
      programId,
      inviteeId: staffId,
      invitedById: leaderId,
    },
  });

  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId,
      applicantId,
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
      leaderId: publishedApplicantId,
      applicantId: publishedApplicantId,
      answers: { title: `합성 단독 팀 ${label}` },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId: p('published-team'),
      programId,
      userId: publishedApplicantId,
    },
  });
  await prisma.team.update({
    where: { id: p('published-team') },
    data: {
      programId,
      applicantId: publishedApplicantId,
      answers: { seedPlaceholder: true, label },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      processedById: staffId,
      processedAt: NOW,
    },
  });
  const provisionedRepositoryId = p('provisioned-repo');
  const provisionedGithubRepositoryId = 9875400000n + ordinal;
  await prisma.githubRepository.create({
    data: {
      id: provisionedRepositoryId,
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
      teamId,
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
      teamId,
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
  await seedDailyContributions(prisma, provisionedGithubRepositoryId, [
    {
      githubId: 9875100000n + ordinal,
      date: '2026-08-06',
      commitCount: 1,
      pullRequestCount: 1,
      releaseCount: 1,
    },
  ]);
  await prisma.githubRepository.create({
    data: {
      id: externalRepositoryId,
      githubRepositoryId: externalGithubRepositoryId,
      nameWithOwner: `purge7-org/${label}-external-public`,
      source: RepositorySource.EXTERNAL_PUBLIC,
      visibility: RepositoryVisibility.PUBLIC,
    },
  });
  await prisma.githubRepository.create({
    data: {
      id: publishedRepositoryId,
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
  await prisma.requirement.create({
    data: {
      id: documentId,
      milestoneId,
      name: '합성 서류 항목',
      required: true,
      sortOrder: 1,
    },
  });
  await storage.put({
    body: Buffer.from('%PDF-template-file'),
    contentType: 'application/pdf',
    originalName: 'template-file.pdf',
    objectKey: templateFileStorageKey,
  });
  await prisma.file.create({
    data: {
      kind: 'TEMPLATE',
      lifecycle: 'ATTACHED',
      id: p('template-file'),
      requirementId: documentId,
      storageKey: templateFileStorageKey,
      originalFileName: 'template-file.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 18,
      uploaderId: staffId,
    },
  });
  await prisma.submission.create({
    data: {
      id: documentSubmissionId,
      requirementId: documentId,
      teamId,
      status: SubmissionStatus.CHANGES_REQUESTED,
      content: {},
      revision: 1,
      submittedById: applicantId,
    },
  });
  await prisma.submissionHistory.create({
    data: {
      id: documentSubmissionHistoryId,
      submissionId: documentSubmissionId,
      event: SubmissionHistoryEvent.SUBMITTED,
      revision: 1,
      content: {},
      actorId: applicantId,
    },
  });
  await prisma.submissionHistory.create({
    data: {
      id: p('document-review-history'),
      submissionId: documentSubmissionId,
      event: 'CHANGES_REQUESTED',
      actorId: staffId,
      comment: 'Synthetic changes requested',
      revision: (
        await prisma.submissionHistory.findUniqueOrThrow({
          where: { id: documentSubmissionHistoryId },
          select: { revision: true },
        })
      ).revision,
    },
  });
  await storage.put({
    body: Buffer.from('%PDF-submission-file'),
    contentType: 'application/pdf',
    originalName: 'submission-file.pdf',
    objectKey: submissionFileStorageKey,
  });
  await prisma.file.create({
    data: {
      kind: 'SUBMISSION',
      id: p('submission-file'),
      uploaderId: applicantId,
      teamId,
      storageKey: submissionFileStorageKey,
      originalFileName: 'submission-file.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 21,
      lifecycle: FileLifecycle.ATTACHED,
      submissionId: documentSubmissionId,
      submissionHistoryId: documentSubmissionHistoryId,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    },
  });
  await prisma.program.update({
    where: { id: programId },
    data: {
      createdBy: 'USER',
      createdById: staffId,
      idempotencyKey: `idempotency:${label}`,
      payloadHash: createHash('sha256').update(label).digest('hex'),
    },
  });
  await prisma.requirement.create({
    data: {
      id: p('authoring-requirement'),
      milestoneId,
      name: 'Authoring template',
      required: false,
      sortOrder: 2,
    },
  });
  await prisma.file.create({
    data: {
      kind: 'TEMPLATE',
      id: p('authoring-upload'),
      uploaderId: staffId,
      storageKey: `${OBJECT_PREFIX}/${label}/authoring-upload.pdf`,
      originalFileName: 'authoring-upload.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      sha256: createHash('sha256')
        .update(`${label}-authoring-upload`)
        .digest('hex'),
      lifecycle: FileLifecycle.ATTACHED,
      attachedAt: NOW,
      requirementId: p('authoring-requirement'),
      pendingExpiresAt: null,
    },
  });
  const applicationOutboxEventId = p('application-outbox-event');
  await prisma.outboxEvent.create({
    data: {
      id: applicationOutboxEventId,
      type: 'REPOSITORY_PROVISION_REQUESTED',
      aggregateType: 'Team',
      aggregateId: teamId,
      idempotencyKey: p('application-outbox-idempotency'),
      payload: { teamId, programId },
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
        teamId,
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
    new ProgramDeletionScopeRepository().readProgramDeletionScopeCounts(
      transaction,
      programId,
    ),
  );
}
async function programChildRowCounts(
  programId: string,
  teamIds: readonly string[] = [],
) {
  const [
    programCovers,
    milestones,
    applications,
    teams,
    teamMembers,
    teamInvitations,
    teamHistories,
    boardPosts,
    boardComments,
    submissionFilesAttached,
    requirements,
    requirementTemplateFiles,
    submissions,
    submissionHistories,
    repositoryProvisionJobs,
    programCreateRequests,
    programAuthoringUploadsAttached,
    applicationOutboxEvents,
    programLinkedNotifications,
  ] = await Promise.all([
    prisma.file.count({ where: { kind: 'COVER', programId: programId } }),
    prisma.milestone.count({ where: { programId } }),
    prisma.team.count({ where: { programId } }),
    prisma.team.count({ where: { programId } }),
    prisma.teamMember.count({ where: { programId } }),
    prisma.teamInvitation.count({ where: { programId } }),
    prisma.teamHistory.count({ where: { programId } }),
    prisma.boardPost.count({ where: { programId } }),
    prisma.boardComment.count({ where: { post: { programId } } }),
    prisma.file.count({
      where: {
        kind: 'SUBMISSION',
        OR: [
          {
            kind: 'SUBMISSION',
            team: { is: { programId } },
          },
          {
            kind: 'SUBMISSION',
            requirement: { milestone: { is: { programId } } },
          },
          {
            kind: 'SUBMISSION',
            submissionHistory: {
              is: {
                submission: {
                  requirement: { milestone: { programId } },
                },
              },
            },
          },
        ],
      },
    }),
    prisma.requirement.count({ where: { milestone: { programId } } }),
    prisma.file.count({
      where: { kind: 'TEMPLATE', requirement: { milestone: { programId } } },
    }),
    prisma.submission.count({
      where: { requirement: { milestone: { programId } } },
    }),
    prisma.submissionHistory.count({
      where: {
        submission: {
          requirement: { milestone: { programId } },
        },
      },
    }),
    prisma.repositoryProvisionJob.count({
      where: { team: { programId } },
    }),
    prisma.program.count({ where: { id: programId, createdBy: 'USER' } }),
    prisma.file.count({ where: { kind: 'UPLOAD', programId: programId } }),
    teamIds.length > 0
      ? prisma.outboxEvent.count({
          where: {
            aggregateType: 'Team',
            aggregateId: { in: [...teamIds] },
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
    teamHistories,
    boardPosts,
    boardComments,
    submissionFilesAttached,
    requirements,
    requirementTemplateFiles,
    submissions,
    submissionHistories,
    repositoryProvisionJobs,
    programCreateRequests,
    programAuthoringUploadsAttached,
    outboxEvents: applicationOutboxEvents,
    programLinkedNotifications,
  };
}
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
  it.each([ProgramLifecycle.PUBLISHED, ProgramLifecycle.DELETED])(
    'student and staff write guards respect committed %s status',
    async (status) => {
      const fixture = await seedFullChildGraph(`guard-${status}`);
      const application = await prisma.team.findUniqueOrThrow({
        where: { id: fixture.teamId },
        select: { applicantId: true },
      });
      await prisma.program.update({
        where: { id: fixture.programId },
        data: { lifecycle: status },
      });
      const staffLock = await prisma.$transaction((tx) =>
        new LockProgramTreeRepository().lockProgramTree(tx, {
          stage: 'program',
          programId: fixture.programId,
        }),
      );
      const studentLock = await prisma.$transaction((tx) =>
        new PlatformRepository().lockSubmissionMembership(
          tx,
          fixture.teamId,
          application.applicantId,
        ),
      );
      expect(staffLock === null).toBe(status === ProgramLifecycle.DELETED);
      expect(studentLock).toBe(status !== ProgramLifecycle.DELETED);
    },
  );
  it('ordinary deletion queues a cover and a failed storage deletion remains retryable', async () => {
    await ensureGlobalActors();
    const programId = `${PREFIX}cover-delete`;
    const storageKey = `${COVER_OBJECT_PREFIX}-cover-delete`;
    await prisma.program.create({
      data: {
        startAt: NOW,
        endAt: new Date(NOW.getTime() + 365 * 86400000),
        id: programId,
        name: '합성 표지 삭제 프로그램',
        organizer: 'Synthetic OSS Center',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: NOW,
        applicationEndAt: NOW,
        description: 'Synthetic cover cleanup fixture',
      },
    });
    await createOwnedCover(programId, storageKey);
    await storage.put({
      objectKey: storageKey,
      originalName: 'synthetic-cover.png',
      contentType: 'image/png',
      body: Buffer.from('synthetic-cover'),
    });
    await lifecycle.delete(ADMIN_GITHUB_ID, programId);
    await expect(
      prisma.program.findUnique({ where: { id: programId } }),
    ).resolves.toMatchObject({ lifecycle: ProgramLifecycle.DELETED });
    await expect(
      prisma.file.findFirst({ where: { kind: 'COVER', programId: programId } }),
    ).resolves.toMatchObject({ programId, storageKey });
    const attemptedAt = new Date();
    const failingCleanup = new FileCleanupService(
      new FileCleanupRepository(prisma),
      { delete: () => Promise.reject(new Error('synthetic storage failure')) },
      () => attemptedAt,
    );
    await expect(failingCleanup.runDue()).resolves.toBe(1);
    await expect(objectExists(storageKey)).resolves.toBe(true);
    const nextDeleteAttemptAt = new Date(
      attemptedAt.getTime() + 60 * 60 * 1000,
    );
    await expect(
      prisma.file.findUnique({
        where: { kind: 'COVER', storageKey: storageKey },
      }),
    ).resolves.toMatchObject({
      lifecycle: FileLifecycle.DELETE_PENDING,
      deleteAttemptCount: 1,
      nextDeleteAttemptAt,
    });
    const retryCleanup = new FileCleanupService(
      new FileCleanupRepository(prisma),
      storage,
      () => nextDeleteAttemptAt,
    );
    await expect(retryCleanup.runDue()).resolves.toBe(1);
    await expect(objectExists(storageKey)).resolves.toBe(false);
    await expect(
      prisma.file.findUnique({
        where: { kind: 'COVER', storageKey: storageKey },
      }),
    ).resolves.toMatchObject({
      lifecycle: FileLifecycle.DELETED,
    });
  });
  it('retains the entire child graph and repository links while workers delete only stored bytes', async () => {
    const fixture = await seedFullChildGraph(
      'full',
      ProgramLifecycle.PUBLISHED,
    );
    const applicant = await prisma.team.findUniqueOrThrow({
      where: { id: fixture.teamId },
      select: { applicantId: true },
    });
    const applicantBefore = await prisma.user.findUniqueOrThrow({
      where: { id: applicant.applicantId },
      select: { id: true, githubId: true, accountStatus: true },
    });
    const submissionFileBefore = await prisma.file.findUniqueOrThrow({
      where: {
        kind: 'SUBMISSION',
        storageKey: fixture.submissionFileStorageKey,
      },
      select: { teamId: true, submissionId: true, submissionHistoryId: true },
    });
    const publishedRepositoryBefore =
      await prisma.githubRepository.findUniqueOrThrow({
        where: { id: fixture.publishedRepositoryId },
        select: {
          teamId: true,
          publishedAt: true,
          visibility: true,
          githubRepositoryId: true,
        },
      });
    const before = await programChildRowCounts(fixture.programId, [
      fixture.teamId,
    ]);
    expect(before.milestones).toBe(1);
    expect(before.programCovers).toBe(1);
    expect(before.teamInvitations).toBe(1);
    expect(before.teamHistories).toBe(1);
    const invitationHistoryBefore = await prisma.teamHistory.findMany({
      where: { programId: fixture.programId },
    });

    expect(before.applications).toBe(2);
    expect(before.submissions).toBe(1);
    expect(before.submissionHistories).toBe(2);
    expect(before.outboxEvents).toBe(1);
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
    const collectedBefore = await repositoryContributionTotals(prisma, [
      fixture.provisionedRepositoryId,
    ]);
    expect(collectedBefore).toEqual({
      commitCount: 1,
      pullRequestCount: 1,
      releaseCount: 1,
      issueCount: 0,
    });
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
      deletedCounts: { files: 4 },
    });
    const after = await programChildRowCounts(fixture.programId, [
      fixture.teamId,
    ]);
    expect(after).toEqual(before);
    await expect(
      prisma.teamHistory.findMany({
        where: { programId: fixture.programId },
      }),
    ).resolves.toEqual(invitationHistoryBefore);
    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.toMatchObject({ lifecycle: ProgramLifecycle.DELETED });
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
    ).resolves.not.toBeNull();
    await expect(
      prisma.notification.findUnique({
        where: { id: fixture.applicationDecisionAcknowledgedNotificationId },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.notification.findUnique({
        where: { id: fixture.deadlineDigestNotificationId },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.outboxEvent.findUnique({
        where: { id: fixture.applicationOutboxEventId },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.repositoryIssuanceHistory.findUnique({
        where: { id: fixture.repositoryIssuanceHistoryId },
      }),
    ).resolves.toMatchObject({
      teamId: fixture.teamId,
      outcome: RepositoryIssuanceOutcome.SUCCEEDED,
      repositoryId: fixture.provisionedRepositoryId,
    });
    await expect(
      prisma.repositoryInvitation.findUnique({
        where: { id: fixture.repositoryInvitationId },
      }),
    ).resolves.toMatchObject({ repositoryId: fixture.provisionedRepositoryId });
    await expect(
      repositoryContributionTotals(prisma, [fixture.provisionedRepositoryId]),
    ).resolves.toEqual(collectedBefore);
    const orphanSubmissionFile = await prisma.file.findFirst({
      where: {
        kind: 'SUBMISSION',
        storageKey: fixture.submissionFileStorageKey,
      },
    });
    expect(orphanSubmissionFile).toMatchObject({
      lifecycle: FileLifecycle.DELETE_PENDING,
      ...submissionFileBefore,
    });
    expect(await objectExists(fixture.submissionFileStorageKey)).toBe(true);
    const tombstone = await prisma.file.findUnique({
      where: { kind: 'TEMPLATE', storageKey: fixture.templateFileStorageKey },
    });
    expect(tombstone).toMatchObject({
      lifecycle: FileLifecycle.DELETE_PENDING,
    });
    expect(await objectExists(fixture.templateFileStorageKey)).toBe(true);
    await expect(
      prisma.file.findUnique({
        where: { kind: 'COVER', storageKey: fixture.coverStorageKey },
      }),
    ).resolves.toMatchObject({
      lifecycle: FileLifecycle.DELETE_PENDING,
    });
    expect(await objectExists(fixture.coverStorageKey)).toBe(true);
    const submissionFileCleanupClaims = await submissionFileCleanup.runDue();
    expect(submissionFileCleanupClaims).toBe(4);
    const templateFileCleanupClaims = await purgeFileCleanup.runDue();
    expect(templateFileCleanupClaims).toBe(0);
    expect(await objectExists(fixture.submissionFileStorageKey)).toBe(false);
    expect(await objectExists(fixture.templateFileStorageKey)).toBe(false);
    expect(await objectExists(fixture.coverStorageKey)).toBe(false);
    await expect(submissionFileCleanup.runDue()).resolves.toBe(0);
    await expect(purgeFileCleanup.runDue()).resolves.toBe(0);
    await expect(
      prisma.file.findUnique({
        where: { kind: 'COVER', storageKey: fixture.coverStorageKey },
      }),
    ).resolves.toMatchObject({
      lifecycle: FileLifecycle.DELETED,
    });
    await expect(
      prisma.file.findFirst({
        where: {
          kind: 'SUBMISSION',
          storageKey: fixture.submissionFileStorageKey,
        },
      }),
    ).resolves.toMatchObject({ lifecycle: FileLifecycle.DELETED });
    await expect(
      prisma.file.findUnique({
        where: { kind: 'TEMPLATE', storageKey: fixture.templateFileStorageKey },
      }),
    ).resolves.toMatchObject({
      lifecycle: FileLifecycle.DELETED,
    });
    const externalRepository = await prisma.githubRepository.findUnique({
      where: { id: fixture.externalRepositoryId },
    });
    expect(externalRepository).toMatchObject({
      githubRepositoryId: fixture.externalGithubRepositoryId,
      source: RepositorySource.EXTERNAL_PUBLIC,
    });
    const provisionedRepositories = await prisma.githubRepository.findMany({
      where: { nameWithOwner: { startsWith: 'purge7-org/full-provisioned' } },
    });
    expect(provisionedRepositories).toHaveLength(1);
    expect(provisionedRepositories[0]).toMatchObject({
      teamId: fixture.teamId,
      source: RepositorySource.ORG_PROVISIONED,
    });
    const publishedRepositoryAfter = await prisma.githubRepository.findUnique({
      where: { id: fixture.publishedRepositoryId },
    });
    expect(publishedRepositoryAfter).toMatchObject(publishedRepositoryBefore);
    const afterPurgePage = await publicProjects.listPage(null, 50);
    expect(
      afterPurgePage.some((row) => row.id === fixture.publishedRepositoryId),
    ).toBe(false);
    const history = await prisma.programHistory.findFirst({
      where: { programId: fixture.programId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(history?.event).toBe('DELETED');
  });
  it('purges a populated program while preserving its account and unrelated programs', async () => {
    const fixture = await seedFullChildGraph('account-keep');
    const unrelatedProgramId = await seedStandaloneProgram('unrelated');
    const applicant = await prisma.team.findUniqueOrThrow({
      where: { id: fixture.teamId },
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
    ).resolves.toEqual({ lifecycle: ProgramLifecycle.PUBLISHED });
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
      deletedCounts: { files: 4 },
    });
    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.toMatchObject({ lifecycle: ProgramLifecycle.DELETED });
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
    const history = await prisma.programHistory.findFirst({
      where: { programId: fixture.programId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(history?.event).toBe('DELETED');
    expect(history?.data).toMatchObject({
      metadata: { lifecycle: ProgramLifecycle.PUBLISHED },
    });
  });

  it('프로그램을 삭제하고 다른 프로그램과 계정을 보존한다', async () => {
    await ensureGlobalActors();
    const programId = await seedStandaloneProgram('isolated-purge');
    const unrelatedProgramId = await seedStandaloneProgram('isolated-keep');
    const unrelatedProgram = await prisma.program.findUniqueOrThrow({
      where: { id: unrelatedProgramId },
    });
    const expectedScope = await currentDeletionScopeCounts(programId);
    await expect(
      lifecycle.purge(ADMIN_GITHUB_ID, programId, expectedScope),
    ).resolves.toMatchObject({ id: programId, deleted: true });
    await expect(
      prisma.program.findUnique({ where: { id: programId } }),
    ).resolves.toMatchObject({ lifecycle: ProgramLifecycle.DELETED });
    await expect(
      prisma.program.findUnique({
        where: { id: unrelatedProgramId },
      }),
    ).resolves.toEqual(unrelatedProgram);
    await expect(
      prisma.user.count({
        where: {
          id: { in: [`${PREFIX}global:student`, `${PREFIX}global:staff`] },
        },
      }),
    ).resolves.toBe(2);
  });

  it('이미 삭제 완료된 SubmissionFile은 상태와 원래 FK를 그대로 보존한다', async () => {
    const fixture = await seedFullChildGraph('deleted-submission-file');
    const application = await prisma.team.findUniqueOrThrow({
      where: { id: fixture.teamId },
      select: { applicantId: true },
    });
    const submission = await prisma.submission.findFirstOrThrow({
      where: { teamId: fixture.teamId },
      select: { id: true },
    });
    const history = await prisma.submissionHistory.findFirstOrThrow({
      where: { submissionId: submission.id },
      select: { id: true },
    });
    const deletedFileId = `${fixture.programId}-deleted-submission-file`;
    const deletedAt = new Date('2026-08-13T00:00:00.000Z');
    await prisma.file.create({
      data: {
        kind: 'SUBMISSION',
        id: deletedFileId,
        uploaderId: application.applicantId,
        teamId: fixture.teamId,
        submissionId: submission.id,
        submissionHistoryId: history.id,
        storageKey: `${OBJECT_PREFIX}/deleted-submission-file/completed.pdf`,
        originalFileName: 'completed.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 21,
        lifecycle: FileLifecycle.DELETED,
        deletedAt: deletedAt,
      },
    });
    const expectedScope = await currentDeletionScopeCounts(fixture.programId);
    await expect(
      lifecycle.purge(ADMIN_GITHUB_ID, fixture.programId, expectedScope),
    ).resolves.toMatchObject({
      id: fixture.programId,
      deleted: true,
      deletedCounts: { files: 4 },
    });
    await expect(
      prisma.file.findUnique({
        where: { kind: 'SUBMISSION', id: deletedFileId },
      }),
    ).resolves.toMatchObject({
      lifecycle: FileLifecycle.DELETED,
      deletedAt,
      teamId: fixture.teamId,
      submissionId: submission.id,
      submissionHistoryId: history.id,
    });
  });
  it('STAFF가 purge하면 삭제 상태가 되고 감사 로그의 행위자가 그 교직원이다', async () => {
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
    ).resolves.toMatchObject({ lifecycle: ProgramLifecycle.DELETED });
    const staff = await prisma.user.findUniqueOrThrow({
      where: { githubId: STAFF_GITHUB_ID },
      select: { id: true },
    });
    const history = await prisma.programHistory.findFirst({
      where: { programId: fixture.programId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(history?.event).toBe('DELETED');
    expect(history?.actorId).toBe(staff.id);
  });
  it('STAFF의 purge도 확인 후 자식 행이 생기면 409 PRG_014로 중단하고 아무것도 지우지 않는다', async () => {
    const fixture = await seedFullChildGraph('staff-toctou-race');
    const expectedScope = await currentDeletionScopeCounts(fixture.programId);
    const raceBoardPostId = `${fixture.programId}-staff-race-board-post`;
    const applicant = await prisma.team.findUniqueOrThrow({
      where: { id: fixture.teamId },
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
      fixture.teamId,
    ]);
    expect(after.milestones).toBe(1);
    expect(after.applications).toBe(2);
    expect(after.boardPosts).toBe(2);
  });
  it('STAFF의 일반 삭제도 모든 자식 행을 보존한다', async () => {
    const fixture = await seedFullChildGraph('staff-blocked');
    const before = await programChildRowCounts(fixture.programId);
    await expect(
      lifecycle.delete(STAFF_GITHUB_ID, fixture.programId),
    ).resolves.toEqual({ id: fixture.programId, deleted: true });
    await expect(programChildRowCounts(fixture.programId)).resolves.toEqual(
      before,
    );
    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.not.toBeNull();
  });
  it('stale_state: purge 이후 같은 프로그램에 대한 기존 가드 delete는 정지된 blockingCounts가 아니라 PROGRAM_NOT_FOUND를 던진다', async () => {
    const fixture = await seedFullChildGraph('stale-state');
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
      fixture.teamId,
    ]);
    expect(before.milestones).toBe(1);
    const failingHistory = {
      append: jest.fn().mockRejectedValue(new Error('induced history failure')),
    } as unknown as ProgramHistoryRepository;
    const failingLifecycle = new ProgramLifecycleService(
      new ProgramLifecycleRepository(
        prisma,
        new ProgramDeletionScopeRepository(),
      ),
      failingHistory,
      new HistoryMetadataService(),
      new PrismaSerializationRetryRepository(),
    );
    const expectedScope = await currentDeletionScopeCounts(fixture.programId);
    await expect(
      failingLifecycle.purge(ADMIN_GITHUB_ID, fixture.programId, expectedScope),
    ).rejects.toThrow('induced history failure');
    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.not.toBeNull();
    const after = await programChildRowCounts(fixture.programId, [
      fixture.teamId,
    ]);
    expect(after).toEqual(before);
    await expect(
      prisma.file.findUnique({
        where: { kind: 'COVER', storageKey: fixture.coverStorageKey },
      }),
    ).resolves.toMatchObject({ lifecycle: 'ATTACHED' });
    expect(await objectExists(fixture.coverStorageKey)).toBe(true);
    const submissionFile = await prisma.file.findFirst({
      where: {
        kind: 'SUBMISSION',
        storageKey: fixture.submissionFileStorageKey,
      },
    });
    expect(submissionFile).toMatchObject({
      lifecycle: FileLifecycle.ATTACHED,
    });
    const externalRepository = await prisma.githubRepository.findUnique({
      where: { id: fixture.externalRepositoryId },
    });
    expect(externalRepository).toMatchObject({
      teamId: null,
      source: RepositorySource.EXTERNAL_PUBLIC,
    });
  });
  it('전체 삭제는 프로그램 상태만 DELETED로 바꾼다', async () => {
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
    ).resolves.toMatchObject({ lifecycle: ProgramLifecycle.DELETED });
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
    const applicant = await prisma.team.findUniqueOrThrow({
      where: { id: fixture.teamId },
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
      fixture.teamId,
    ]);
    expect(after.milestones).toBe(1);
    expect(after.applications).toBe(2);
    expect(after.teams).toBe(2);
    expect(after.boardPosts).toBe(2);
    expect(after.submissions).toBe(1);
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
        const applicant = await prisma.team.findUniqueOrThrow({
          where: { id: fixture.teamId },
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
        const applicant = await prisma.team.findUniqueOrThrow({
          where: { id: fixture.teamId },
          select: { applicantId: true },
        });
        await concurrentPrisma.team.create({
          data: {
            id: raceId,
            programId: fixture.programId,
            name: 'Committed team during purge',
            leaderId: applicant.applicantId,
            applicantId: applicant.applicantId,
            answers: { title: 'Committed team during purge' },
            applicationTemplateVersion: 1,
          },
        });
      },
    },
    {
      scopeField: 'applications',
      insertRacingChildRow: async (fixture, raceId) => {
        const applicant = await prisma.team.findUniqueOrThrow({
          where: { id: fixture.teamId },
          select: { applicantId: true },
        });
        const raceTeamId = `${raceId}-team`;
        await concurrentPrisma.team.create({
          data: {
            id: raceTeamId,
            programId: fixture.programId,
            name: 'Committed application team during purge',
            leaderId: applicant.applicantId,
            applicantId: applicant.applicantId,
            answers: { title: 'Committed application team during purge' },
            applicationTemplateVersion: 1,
          },
        });
        await concurrentPrisma.team.update({
          where: { id: raceTeamId },
          data: {
            programId: fixture.programId,
            applicantId: applicant.applicantId,
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
        await concurrentPrisma.requirement.create({
          data: {
            id: raceDocumentId,
            milestoneId: fixture.milestoneId,
            name: 'Committed target document during purge',
            required: true,
            sortOrder: 2,
          },
        });
        await concurrentPrisma.submission.create({
          data: {
            id: raceId,
            requirementId: raceDocumentId,
            teamId: fixture.teamId,
            status: SubmissionStatus.SUBMITTED,
            revision: 1,
            submittedById: (
              await prisma.team.findUniqueOrThrow({
                where: { id: fixture.teamId },
                select: { applicantId: true },
              })
            ).applicantId,
          },
        });
      },
    },
  ];
  it.each(IN_TRANSACTION_RACE_CASES)(
    'race: 상태 삭제는 자식을 지우지 않으므로 확인 snapshot 이후 추가된 $scopeField를 보존하고 성공한다',
    async ({ scopeField, insertRacingChildRow }) => {
      const fixture = await seedFullChildGraph(`in-tx-race-${scopeField}`);
      const programs = new ProgramsRepository(
        prisma,
        new PlatformRepository(),
        new ProgramListStatusFilterRepository(),
      );
      const { name } = await prisma.program.findUniqueOrThrow({
        where: { id: fixture.programId },
        select: { name: true },
      });
      const query = {
        page: 1,
        pageSize: 100,
        search: name,
        status: 'all' as const,
      };
      const [visibleRows, visibleCount] = await programs.listPrograms(
        query,
        NOW,
      );
      expect(visibleRows.map((row) => row.id)).toEqual([fixture.programId]);
      expect(visibleCount).toBe(1);
      const before = await programChildRowCounts(fixture.programId, [
        fixture.teamId,
      ]);
      const expectedScope = await currentDeletionScopeCounts(fixture.programId);
      const scopeRead = deferred();
      const resumePurge = deferred();
      let requestedOptions: InteractiveTransactionOptions | undefined;
      const pausingLifecycle = new ProgramLifecycleService(
        new ProgramLifecycleRepository(
          pausingScopeReadPrisma(
            async () => {
              scopeRead.resolve();
              await resumePurge.promise;
            },
            (options) => {
              requestedOptions = options;
            },
          ),
          new ProgramDeletionScopeRepository(),
        ),
        programHistory,
        new HistoryMetadataService(),
        new PrismaSerializationRetryRepository(),
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
      await expect(purge).resolves.toMatchObject({
        id: fixture.programId,
        deleted: true,
      });
      expect(requestedOptions).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      const after = await programChildRowCounts(fixture.programId, [
        fixture.teamId,
      ]);
      const expectedAfter = { ...before };
      if (scopeField === 'boardPosts') {
        expectedAfter.boardPosts = before.boardPosts + 1;
      } else if (scopeField === 'teams' || scopeField === 'applications') {
        expectedAfter.applications = before.applications + 1;
        expectedAfter.teams = before.teams + 1;
      } else {
        expectedAfter.submissions = before.submissions + 1;
        expectedAfter.requirements = before.requirements + 1;
      }
      expect(after).toEqual(expectedAfter);
      await expect(
        prisma.program.findUnique({ where: { id: fixture.programId } }),
      ).resolves.toMatchObject({ lifecycle: ProgramLifecycle.DELETED });
      const [rows, count] = await programs.listPrograms(query, NOW);
      expect(rows).toEqual([]);
      expect(count).toBe(0);
      await expect(
        programs.findProgramDetail(fixture.programId),
      ).resolves.toBeNull();
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
    ).resolves.toMatchObject({ lifecycle: ProgramLifecycle.DELETED });
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

async function createOwnedCover(programId: string, storageKey: string) {
  const cover = await prisma.file.create({
    data: {
      kind: 'COVER',
      lifecycle: 'ATTACHED',
      programId,
      storageKey,
      mimeType: 'image/png',
      sizeBytes: 1,
    },
  });
  await prisma.program.update({
    where: { id: programId },
    data: { coverFileId: cover.id },
  });
}
