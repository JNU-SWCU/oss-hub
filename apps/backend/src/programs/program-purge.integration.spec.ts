import { createHash } from 'node:crypto';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  AccountStatus,
  ApplicationStatus,
  BoardPostCategory,
  MilestoneSubmissionType,
  ProgramAuthoringUploadLifecycle,
  ProgramCategory,
  ProgramPurgeFileTombstoneLifecycle,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ReviewDecision,
  Role,
  SubmissionFileLifecycle,
  SubmissionStatus,
  TeamInvitationStatus,
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
const NOW = new Date('2026-08-12T00:00:00.000Z');
const ADMIN_GITHUB_ID = 9_875_000_001n;
const STAFF_GITHUB_ID = 9_875_000_002n;

const prisma = new PrismaService();
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
// worker는 purge가 쓴 nextDeleteAttemptAt(실제 벥시개)을 따라잡아야 하므로 고정된 NOW가
// 아니라 실제 시계를 쓴다.
const purgeFileCleanup = new ProgramPurgeFileCleanupService(
  new ProgramPurgeFileCleanupRepository(prisma),
  storage,
);
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
  readonly externalRepositoryId: string;
  readonly externalGithubRepositoryId: bigint;
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
    where: { storageKey: { startsWith: OBJECT_PREFIX } },
    select: { storageKey: true },
  });
  await Promise.all(
    tombstones.map(({ storageKey }) => storage.delete(storageKey)),
  );
  await prisma.programPurgeFileTombstone.deleteMany({
    where: { storageKey: { startsWith: OBJECT_PREFIX } },
  });
  await storage.delete(`${OBJECT_PREFIX}/submission-file.pdf`).catch(() => {});
  await storage.delete(`${OBJECT_PREFIX}/template-file.pdf`).catch(() => {});

  // AuditLog는 append-only로 DELETE가 DB 트리거로 차단된다(20260731130000) — 합성 actor가 남기는
  // 행은 지우지 않고 다음 실행에서도 targetId로만 조회하므로 무해하다.
  await prisma.milestoneDocumentReviewHistory.deleteMany({
    where: {
      milestoneDocumentSubmission: {
        milestoneDocument: { milestone: { program: { id: { startsWith: PREFIX } } } },
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
  await prisma.milestoneDocumentSubmission.deleteMany({
    where: { milestoneDocument: { milestone: { program: { id: { startsWith: PREFIX } } } } },
  });
  await prisma.milestoneDocumentTemplateFile.deleteMany({
    where: { milestoneDocument: { milestone: { program: { id: { startsWith: PREFIX } } } } },
  });
  await prisma.milestoneDocument.deleteMany({
    where: { milestone: { program: { id: { startsWith: PREFIX } } } },
  });
  await prisma.review.deleteMany({
    where: { submissionRevision: { submission: { milestone: { program: { id: { startsWith: PREFIX } } } } } },
  });
  await prisma.submissionRevision.deleteMany({
    where: { submission: { milestone: { program: { id: { startsWith: PREFIX } } } } },
  });
  await prisma.submission.deleteMany({
    where: { milestone: { program: { id: { startsWith: PREFIX } } } },
  });
  await prisma.repositoryProvisionJob.deleteMany({
    where: { application: { programId: { startsWith: PREFIX } } },
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
  await prisma.publicShowcaseRepository.deleteMany({
    where: { programId: { startsWith: PREFIX } },
  });
  await prisma.outboxEvent.deleteMany({
    where: { aggregateId: { startsWith: PREFIX } },
  });
  await prisma.program.deleteMany({ where: { id: { startsWith: PREFIX } } });
  // 전역 admin/staff-forbidden 액터는 AuditLog(append-only)가 actorId를 RESTRICT로
  // 참조하므로 삭제하지 않고 재사용한다 — upsert가 멍등성을 보장한다.
  await prisma.user.deleteMany({
    where: { id: { startsWith: PREFIX }, NOT: { id: { startsWith: `${PREFIX}global:` } } },
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
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  await prisma.user.upsert({
    where: { githubId: STAFF_GITHUB_ID },
    update: {},
    create: {
      id: `${PREFIX}global:staff-forbidden`,
      githubId: STAFF_GITHUB_ID,
      nickname: 'synthetic-purge7-staff-forbidden',
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
}

async function seedFullChildGraph(label: string): Promise<Fixture> {
  const p = (suffix: string) => `${PREFIX}${label}:${suffix}`;
  const ordinal = labelOrdinal(label);
  const programId = p('program');
  const milestoneId = p('milestone');
  const applicantId = p('applicant');
  const leaderId = p('leader');
  const staffId = p('staff-reviewer');
  const teamId = p('team');
  const applicationId = p('application');
  const submissionId = p('submission');
  const revisionId = p('revision');
  const documentId = p('document');
  const documentSubmissionId = p('document-submission');
  const boardPostId = p('board-post');
  const boardCommentId = p('board-comment');
  const submissionFileStorageKey = `${OBJECT_PREFIX}/${label}/submission-file.pdf`;
  const templateFileStorageKey = `${OBJECT_PREFIX}/${label}/template-file.pdf`;
  const externalRepositoryId = p('external-repo');
  const externalGithubRepositoryId = 9_875_500_000n + ordinal;

  await ensureGlobalActors();
  await prisma.user.createMany({
    data: [
      {
        id: applicantId,
        githubId: 9_875_100_000n + ordinal,
        nickname: `synthetic-purge7-applicant-${label}`,
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: leaderId,
        githubId: 9_875_200_000n + ordinal,
        nickname: `synthetic-purge7-leader-${label}`,
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: staffId,
        githubId: 9_875_300_000n + ordinal,
        nickname: `synthetic-purge7-staff-${label}`,
        role: Role.STAFF,
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
      category: ProgramCategory.CAPSTONE,
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
      { id: p('team-member-applicant'), teamId, programId, userId: applicantId },
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

  // ORG_PROVISIONED repository — provisioning artifact scoped to this application/team.
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

  // EXTERNAL_PUBLIC repository — global collection asset, linked only via programId here.
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

  await prisma.submission.create({
    data: {
      id: submissionId,
      milestoneId,
      applicationId,
      status: SubmissionStatus.SUBMITTED,
      currentRevision: 1,
    },
  });
  await prisma.submissionRevision.create({
    data: {
      id: revisionId,
      submissionId,
      revision: 1,
      submissionType: MilestoneSubmissionType.FILE,
      content: {},
      submittedById: applicantId,
    },
  });
  await prisma.review.create({
    data: {
      id: p('review'),
      submissionRevisionId: revisionId,
      reviewerId: staffId,
      decision: ReviewDecision.APPROVED,
      comment: 'Synthetic approval',
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
      submissionRevisionId: revisionId,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    },
  });

  await prisma.milestoneDocument.create({
    data: {
      id: documentId,
      milestoneId,
      name: '합성 서류 항목',
      required: true,
      sortOrder: 1,
      submissionType: MilestoneSubmissionType.FILE,
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
    },
  });
  await prisma.milestoneDocumentReviewHistory.create({
    data: {
      id: p('document-review-history'),
      milestoneDocumentSubmissionId: documentSubmissionId,
      reviewerId: staffId,
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: 'Synthetic changes requested',
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
      sha256: createHash('sha256').update(`${label}-authoring-upload`).digest('hex'),
      lifecycle: ProgramAuthoringUploadLifecycle.ATTACHED,
      attachedAt: NOW,
      createRequestActorId: staffId,
      createRequestId,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    },
  });

  await prisma.publicShowcaseRepository.create({
    data: {
      repositoryId: provisionedRepositoryId,
      githubRepositoryId: provisionedGithubRepositoryId,
      repositoryName: `${label}-provisioned`,
      repositoryUrl: `https://github.com/purge7-org/${label}-provisioned`,
      publishedAt: NOW,
      programId,
      programName: `합성 purge 대상 프로그램 ${label}`,
      programCategory: ProgramCategory.CAPSTONE,
      programEndAt: new Date('2026-09-30T00:00:00.000Z'),
      teamName: `합성 팀 ${label}`,
      displayName: `synthetic-purge7-applicant-${label}`,
      approvedSubmissionCount: 1,
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

  return {
    programId,
    milestoneId,
    applicationId,
    teamId,
    submissionFileStorageKey,
    templateFileStorageKey,
    externalRepositoryId,
    externalGithubRepositoryId,
  };
}

async function programChildRowCounts(programId: string) {
  const [
    milestones,
    applications,
    teams,
    teamMembers,
    teamInvitations,
    boardPosts,
    boardComments,
    submissions,
    submissionRevisions,
    reviews,
    submissionFilesAttached,
    milestoneDocuments,
    milestoneDocumentTemplateFiles,
    milestoneDocumentSubmissions,
    milestoneDocumentReviewHistories,
    repositoryProvisionJobs,
    programCreateRequests,
    programAuthoringUploadsAttached,
    publicShowcaseRepositories,
    outboxEvents,
  ] = await Promise.all([
    prisma.milestone.count({ where: { programId } }),
    prisma.application.count({ where: { programId } }),
    prisma.team.count({ where: { programId } }),
    prisma.teamMember.count({ where: { programId } }),
    prisma.teamInvitation.count({ where: { programId } }),
    prisma.boardPost.count({ where: { programId } }),
    prisma.boardComment.count({ where: { post: { programId } } }),
    prisma.submission.count({ where: { milestone: { programId } } }),
    prisma.submissionRevision.count({
      where: { submission: { milestone: { programId } } },
    }),
    prisma.review.count({
      where: { submissionRevision: { submission: { milestone: { programId } } } },
    }),
    prisma.submissionFile.count({
      where: {
        OR: [
          { application: { is: { programId } } },
          { milestone: { is: { programId } } },
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
    prisma.publicShowcaseRepository.count({ where: { programId } }),
    prisma.outboxEvent.count({
      where: { aggregateType: 'PROGRAM', aggregateId: programId },
    }),
  ]);
  return {
    milestones,
    applications,
    teams,
    teamMembers,
    teamInvitations,
    boardPosts,
    boardComments,
    submissions,
    submissionRevisions,
    reviews,
    submissionFilesAttached,
    milestoneDocuments,
    milestoneDocumentTemplateFiles,
    milestoneDocumentSubmissions,
    milestoneDocumentReviewHistories,
    repositoryProvisionJobs,
    programCreateRequests,
    programAuthoringUploadsAttached,
    publicShowcaseRepositories,
    outboxEvents,
  };
}

const ALL_ZERO = {
  milestones: 0,
  applications: 0,
  teams: 0,
  teamMembers: 0,
  teamInvitations: 0,
  boardPosts: 0,
  boardComments: 0,
  submissions: 0,
  submissionRevisions: 0,
  reviews: 0,
  submissionFilesAttached: 0,
  milestoneDocuments: 0,
  milestoneDocumentTemplateFiles: 0,
  milestoneDocumentSubmissions: 0,
  milestoneDocumentReviewHistories: 0,
  repositoryProvisionJobs: 0,
  programCreateRequests: 0,
  programAuthoringUploadsAttached: 0,
  publicShowcaseRepositories: 0,
  outboxEvents: 0,
};

describe('Program purge integration — full child graph, worker file deletion, EXTERNAL_PUBLIC preservation', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(cleanup);

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    s3.destroy();
    await prisma.$disconnect();
  });

  it('purges the entire child graph, defers file deletion to the worker, and preserves+detaches EXTERNAL_PUBLIC repositories', async () => {
    const fixture = await seedFullChildGraph('full');

    const before = await programChildRowCounts(fixture.programId);
    expect(before.milestones).toBe(1);
    expect(before.applications).toBe(1);
    expect(before.reviews).toBe(1);
    expect(before.milestoneDocumentReviewHistories).toBe(1);

    const result = await lifecycle.purge(ADMIN_GITHUB_ID, fixture.programId);
    expect(result).toMatchObject({ id: fixture.programId, deleted: true });

    // 오도된 성공 출력 방지 — 서비스 반환값이 아니라 DB를 직접 조회해 검증한다.
    const after = await programChildRowCounts(fixture.programId);
    expect(after).toEqual(ALL_ZERO);
    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.toBeNull();

    // SubmissionFile은 하드 삭제가 아니라 FK를 분리한 DELETE_PENDING 행으로 worker에 남는다.
    const orphanSubmissionFile = await prisma.submissionFile.findFirst({
      where: { storageKey: fixture.submissionFileStorageKey },
    });
    expect(orphanSubmissionFile).toMatchObject({
      lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
      applicationId: null,
      milestoneId: null,
      submissionRevisionId: null,
    });
    expect(await objectExists(fixture.submissionFileStorageKey)).toBe(true);

    // template file은 tombstone으로 옮겨져 있고, 원 storage 객체는 트랜잭션 중에는 지워지지 않는다.
    const tombstone = await prisma.programPurgeFileTombstone.findUnique({
      where: { storageKey: fixture.templateFileStorageKey },
    });
    expect(tombstone).toMatchObject({
      lifecycle: ProgramPurgeFileTombstoneLifecycle.DELETE_PENDING,
    });
    expect(await objectExists(fixture.templateFileStorageKey)).toBe(true);

    // phase 2: worker가 실제 storage 객체를 지운다.
    const submissionFileCleanupClaims = await submissionFileCleanup.runDue();
    expect(submissionFileCleanupClaims).toBeGreaterThanOrEqual(1);
    const templateFileCleanupClaims = await purgeFileCleanup.runDue();
    expect(templateFileCleanupClaims).toBeGreaterThanOrEqual(1);

    expect(await objectExists(fixture.submissionFileStorageKey)).toBe(false);
    expect(await objectExists(fixture.templateFileStorageKey)).toBe(false);
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

    // EXTERNAL_PUBLIC 저장소 행은 보존되고 program 연결만 해제된다 — 수집 이력 유지.
    const externalRepository = await prisma.githubRepository.findUnique({
      where: { id: fixture.externalRepositoryId },
    });
    expect(externalRepository).toMatchObject({
      programId: null,
      githubRepositoryId: fixture.externalGithubRepositoryId,
      source: RepositorySource.EXTERNAL_PUBLIC,
    });

    // ORG_PROVISIONED 저장소도 삭제가 아니라 연결 해제 후 보존된다.
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

    // 감사 이벤트가 기록됐다.
    const audit = await prisma.auditLog.findFirst({
      where: { targetType: 'PROGRAM', targetId: fixture.programId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.action).toBe('PROGRAM_DELETED');
  });

  it('STAFF가 purge를 시도하면 403 PRG_011을 받고 프로그램은 그대로 남는다', async () => {
    const fixture = await seedFullChildGraph('staff-forbidden');

    await expect(
      lifecycle.purge(STAFF_GITHUB_ID, fixture.programId),
    ).rejects.toBeInstanceOf(DomainException);
    await expect(
      lifecycle.purge(STAFF_GITHUB_ID, fixture.programId),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN },
    });

    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.not.toBeNull();
    const after = await programChildRowCounts(fixture.programId);
    expect(after.milestones).toBe(1);
    expect(after.applications).toBe(1);
  });

  it('stale_state: purge 이후 같은 프로그램에 대한 기존 가드 delete는 정지된 blockingCounts가 아니라 PROGRAM_NOT_FOUND를 던진다', async () => {
    const fixture = await seedFullChildGraph('stale-state');

    // purge 전: 자식이 있으니 기존 가드 delete는 409 blockingCounts를 반환한다.
    await expect(
      lifecycle.delete(ADMIN_GITHUB_ID, fixture.programId),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_DELETE_BLOCKED },
      extensions: {
        blockingCounts: expect.objectContaining({ applications: 1 }) as unknown,
      },
    });

    await lifecycle.purge(ADMIN_GITHUB_ID, fixture.programId);

    // purge 후: 프로그램 자체가 사라졌으므로 blockingCounts를 재사용하지 않고 404를 던져야 한다.
    await expect(
      lifecycle.delete(ADMIN_GITHUB_ID, fixture.programId),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_NOT_FOUND },
    });
    await expect(
      lifecycle.purge(ADMIN_GITHUB_ID, fixture.programId),
    ).rejects.toMatchObject({
      errorCode: { code: ProgramErrorCode.PROGRAM_NOT_FOUND },
    });
  });

  it('atomicity: 트랜잭션 중간에 실패를 유도하면 전부 롤백되고 부분 삭제가 남지 않는다', async () => {
    const fixture = await seedFullChildGraph('atomic-rollback');
    const before = await programChildRowCounts(fixture.programId);
    expect(before.milestones).toBe(1);
    expect(before.reviews).toBe(1);

    const failingAuditLog = {
      record: jest.fn().mockRejectedValue(new Error('induced audit failure')),
    } as unknown as AuditLogService;
    const failingLifecycle = new ProgramLifecycleService(
      prisma,
      failingAuditLog,
    );

    await expect(
      failingLifecycle.purge(ADMIN_GITHUB_ID, fixture.programId),
    ).rejects.toThrow('induced audit failure');

    // all-or-nothing: 감사 기록 실패로 트랜잭션 전체가 롤백돼 자식 행이 전부 그대로 남는다.
    await expect(
      prisma.program.findUnique({ where: { id: fixture.programId } }),
    ).resolves.not.toBeNull();
    const after = await programChildRowCounts(fixture.programId);
    expect(after).toEqual(before);
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
});
