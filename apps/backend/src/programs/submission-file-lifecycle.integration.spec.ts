import {
  FileMetadataRepository,
  FileCleanupRepository,
  FilesRepository,
} from './files.repository';
import { FileCleanupService } from './file-cleanup.service';
import { ProgramScheduleService } from './program-schedule.service';
import { SubmissionFileAdmissionService, FilesService } from './files.service';
import { DownloadResponseService } from './download-response.service';
import { PlatformRepository } from '../platform/platform.repository';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  MilestoneDocumentSubmissionHistoryEvent,
  MilestoneSubmissionType,
  FileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { runProfile } from '../../prisma/seed';
import { seedGithubId, seedId, SeedStats } from '../../prisma/seeds/helpers';
import { MILESTONE_SCENARIOS } from '../../prisma/seeds/milestones';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { S3ObjectStorageClient } from '../platform/s3-object-storage.client';
import { ObjectStorageConfig } from '../platform/object-storage.config';
import { signatureValidZip } from './submission-zip-builder.fixture';

const programScheduleService = new ProgramScheduleService();
const REQUIRED_ENV = [
  'DATABASE_URL',
  'SUBMISSION_FILE_S3_ENDPOINT',
  'SUBMISSION_FILE_S3_REGION',
  'SUBMISSION_FILE_S3_BUCKET',
  'SUBMISSION_FILE_S3_ACCESS_KEY_ID',
  'SUBMISSION_FILE_S3_SECRET_ACCESS_KEY',
  'SUBMISSION_FILE_S3_FORCE_PATH_STYLE',
] as const;
const integrationReady =
  process.env.OSS_HUB_INTEGRATION_RUNNER ===
    'oss-hub-isolated-integration-v1' &&
  REQUIRED_ENV.every((name) => (process.env[name]?.trim().length ?? 0) > 0);
if (integrationReady) {
  assertIsolatedIntegrationDatabase({
    databaseUrl: process.env.DATABASE_URL,
    runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
  });
}
const describeIntegration = integrationReady ? describe : describe.skip;
const prisma = new PrismaService();
const cleanupFiles = new FileCleanupRepository(prisma);
const files = new FilesRepository(
  prisma,
  new PlatformRepository(),
  new FileMetadataRepository(),
);
const storageConfig = new ObjectStorageConfig();
const storage = new S3ObjectStorageClient(storageConfig);
const APPLICATION_ID = seedId('milestones', 'application', 'personal');
const USER_ID = seedId('milestones', 'user', 'applicant-personal');
const MILESTONE_ID = MILESTONE_SCENARIOS['milestones-upcoming'][0];
const PREFIX = 'integration/submission-file-lifecycle';
const SUBMISSION_PREFIX = 'integration-submission-file-lifecycle';
const BASE = new Date('2026-07-25T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
function s3Client(): S3Client {
  const settings = storageConfig.requireSettings();
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
}
async function persistedFootprint() {
  const client = s3Client();
  try {
    const objects = await client.send(
      new ListObjectsV2Command({
        Bucket: storageConfig.requireSettings().bucket,
      }),
    );
    return {
      submissionFiles: await prisma.file.count(),
      auditLogs: await prisma.auditLog.count(),
      outboxEvents: await prisma.outboxEvent.count(),
      storedObjects: objects.KeyCount ?? 0,
    };
  } finally {
    client.destroy();
  }
}
async function createPending(options: {
  suffix: string;
  pendingExpiresAt?: Date;
  expiresAt?: Date;
  originalFileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}) {
  return prisma.file.create({
    data: {
      kind: 'SUBMISSION',
      uploaderId: USER_ID,
      teamId: APPLICATION_ID,
      requirementId: (
        await prisma.milestoneDocument.findFirstOrThrow({
          where: { milestoneId: MILESTONE_ID },
          select: { id: true },
        })
      ).id,
      storageKey: `${PREFIX}/${options.suffix}`,
      originalFileName: options.originalFileName ?? 'synthetic.pdf',
      mimeType: options.mimeType ?? 'application/pdf',
      sizeBytes: options.sizeBytes ?? 14,
      lifecycle: FileLifecycle.PENDING,
      pendingExpiresAt:
        options.pendingExpiresAt ?? new Date(BASE.getTime() + HOUR),
      expiresAt:
        options.expiresAt ?? programScheduleService.addOneCalendarYear(BASE),
    },
  });
}
async function createSubmissionHistory(suffix: string): Promise<{
  submissionId: string;
  historyId: string;
}> {
  const documentId = `${SUBMISSION_PREFIX}-document-${suffix}`;
  const submissionId = `${SUBMISSION_PREFIX}-${suffix}`;
  const historyId = `${SUBMISSION_PREFIX}-history-${suffix}`;
  await prisma.milestoneDocument.create({
    data: {
      milestoneId: MILESTONE_ID,
      id: documentId,
      name: `synthetic file ${suffix}`,
      required: true,
      sortOrder: -1,
    },
  });
  await prisma.milestoneDocumentSubmission.create({
    data: {
      id: submissionId,
      milestoneDocumentId: documentId,
      teamId: APPLICATION_ID,
      status: SubmissionStatus.SUBMITTED,
      revision: 1,
      submittedById: USER_ID,
    },
  });
  await prisma.milestoneDocumentSubmissionHistory.create({
    data: {
      id: historyId,
      milestoneDocumentSubmissionId: submissionId,
      event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
      revision: 1,
      content: { type: MilestoneSubmissionType.FILE },
      actorId: USER_ID,
    },
  });
  return { submissionId, historyId };
}
describeIntegration(
  'submission file lifecycle PostgreSQL + object-storage integration',
  () => {
    beforeAll(async () => {
      await prisma.$connect();
      await runProfile('milestones', new SeedStats());
    });
    afterEach(async () => {
      const rows = await prisma.file.findMany({
        where: { kind: 'SUBMISSION', storageKey: { startsWith: PREFIX } },
        select: { storageKey: true },
      });
      await Promise.all(
        rows.map(({ storageKey }) => storage.delete(storageKey)),
      );
      await prisma.file.deleteMany({
        where: { kind: 'SUBMISSION', storageKey: { startsWith: PREFIX } },
      });
      await prisma.milestoneDocumentSubmissionHistory.deleteMany({
        where: { submission: { id: { startsWith: SUBMISSION_PREFIX } } },
      });
      await prisma.milestoneDocumentSubmission.deleteMany({
        where: { id: { startsWith: SUBMISSION_PREFIX } },
      });
      await prisma.milestoneDocument.deleteMany({
        where: { id: { startsWith: `${SUBMISSION_PREFIX}-document-` } },
      });
    });
    afterAll(async () => {
      await prisma.$disconnect();
    });
    it('performs a real PUT and idempotent delete against object-storage', async () => {
      const objectKey = `${PREFIX}/put-delete`;
      const body = Buffer.from('%PDF-synthetic');
      await storage.put({
        body,
        contentType: 'application/pdf',
        originalName: 'synthetic.pdf',
        objectKey,
      });
      const client = s3Client();
      const settings = storageConfig.requireSettings();
      const fetched = await client.send(
        new GetObjectCommand({ Bucket: settings.bucket, Key: objectKey }),
      );
      await expect(fetched.Body?.transformToByteArray()).resolves.toEqual(
        Uint8Array.from(body),
      );
      await expect(storage.delete(objectKey)).resolves.toBeUndefined();
      await expect(storage.delete(objectKey)).resolves.toBeUndefined();
      await expect(
        client.send(
          new HeadObjectCommand({ Bucket: settings.bucket, Key: objectKey }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      client.destroy();
    });
    it('moves expired ATTACHED through DELETE_PENDING to DELETED with the real object removed', async () => {
      const row = await createPending({
        suffix: 'full-lifecycle',
        expiresAt: new Date(BASE.getTime() - HOUR),
      });
      const submission = await createSubmissionHistory('full-lifecycle');
      await storage.put({
        body: Buffer.from('%PDF-synthetic'),
        contentType: 'application/pdf',
        originalName: 'synthetic.pdf',
        objectKey: row.storageKey,
      });
      await prisma.file.update({
        where: { kind: 'SUBMISSION', id: row.id },
        data: {
          lifecycle: FileLifecycle.ATTACHED,
          pendingExpiresAt: null,
          submissionId: submission.submissionId,
          submissionHistoryId: submission.historyId,
        },
      });
      const claimed = await cleanupFiles.claimNextForDeletion({
        now: BASE,
        leaseExpiresAt: new Date(BASE.getTime() + 10 * 60000),
      });
      expect(claimed).toMatchObject({ id: row.id, storageKey: row.storageKey });
      await storage.delete(row.storageKey);
      await expect(
        cleanupFiles.markDeleted(row.id, claimed!.claimOwner, BASE),
      ).resolves.toBe(true);
      await expect(
        prisma.file.findUniqueOrThrow({
          where: { kind: 'SUBMISSION', id: row.id },
        }),
      ).resolves.toMatchObject({
        lifecycle: FileLifecycle.DELETED,
        deletedAt: BASE,
        deleteClaimOwner: null,
      });
      const client = s3Client();
      await expect(
        client.send(
          new HeadObjectCommand({
            Bucket: storageConfig.requireSettings().bucket,
            Key: row.storageKey,
          }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      client.destroy();
    });
    it('preserves an ATTACHED revision file until retention expiry', async () => {
      const row = await createPending({
        suffix: 'referenced-attached-retained',
        expiresAt: new Date(BASE.getTime() + HOUR),
      });
      const submission = await createSubmissionHistory(
        'referenced-attached-retained',
      );
      await prisma.file.update({
        where: { kind: 'SUBMISSION', id: row.id },
        data: {
          lifecycle: FileLifecycle.ATTACHED,
          pendingExpiresAt: null,
          submissionId: submission.submissionId,
          submissionHistoryId: submission.historyId,
        },
      });
      await expect(
        cleanupFiles.claimNextForDeletion({
          now: BASE,
          leaseExpiresAt: new Date(BASE.getTime() + 10 * 60000),
        }),
      ).resolves.toBeNull();
    });
    it('uses PostgreSQL SKIP LOCKED so two workers cannot claim the same file', async () => {
      const row = await createPending({
        suffix: 'exclusive-claim',
        pendingExpiresAt: new Date(BASE.getTime() - HOUR),
      });
      const claims = await Promise.all([
        cleanupFiles.claimNextForDeletion({
          now: BASE,
          leaseExpiresAt: new Date(BASE.getTime() + 10 * 60000),
        }),
        cleanupFiles.claimNextForDeletion({
          now: BASE,
          leaseExpiresAt: new Date(BASE.getTime() + 10 * 60000),
        }),
      ]);
      expect(claims.filter((claim) => claim?.id === row.id)).toHaveLength(1);
      expect(claims.filter((claim) => claim === null)).toHaveLength(1);
    });
    it('allows expired lease takeover and rejects completion or failure from the stale owner', async () => {
      const row = await createPending({
        suffix: 'lease-takeover',
        pendingExpiresAt: new Date(BASE.getTime() - HOUR),
      });
      const first = await cleanupFiles.claimNextForDeletion({
        now: BASE,
        leaseExpiresAt: new Date(BASE.getTime() + 10 * 60000),
      });
      const takeoverAt = new Date(BASE.getTime() + 11 * 60000);
      const second = await cleanupFiles.claimNextForDeletion({
        now: takeoverAt,
        leaseExpiresAt: new Date(takeoverAt.getTime() + 10 * 60000),
      });
      expect(second?.id).toBe(row.id);
      expect(second?.claimOwner).not.toBe(first?.claimOwner);
      await expect(
        cleanupFiles.markDeleted(row.id, first!.claimOwner, takeoverAt),
      ).resolves.toBe(false);
      await expect(
        cleanupFiles.recordDeleteFailure({
          id: row.id,
          claimOwner: first!.claimOwner,
          attemptCount: 1,
          nextAttemptAt: new Date(takeoverAt.getTime() + HOUR),
          error: 'STORAGE_DELETE_FAILED',
        }),
      ).resolves.toBe(false);
      await expect(
        cleanupFiles.markDeleted(row.id, second!.claimOwner, takeoverAt),
      ).resolves.toBe(true);
    });
    it('records one attempt and keeps the row when the worker storage delete fails', async () => {
      const row = await createPending({
        suffix: 'worker-delete-failure',
        pendingExpiresAt: new Date(Date.now() - HOUR),
      });
      const worker = new FileCleanupService(cleanupFiles, {
        delete: () => Promise.reject(new Error('synthetic storage outage')),
      });

      await worker.runDue();

      const file = await prisma.file.findUniqueOrThrow({
        where: { kind: 'SUBMISSION', id: row.id },
      });
      expect(file).toMatchObject({
        lifecycle: FileLifecycle.DELETE_PENDING,
        deleteAttemptCount: 1,
        lastDeleteError: 'STORAGE_DELETE_FAILED',
        deleteClaimOwner: null,
      });
      expect(file.nextDeleteAttemptAt).not.toBeNull();
    });

    it('persists retry backoff, exhaustion, and operator reset in PostgreSQL', async () => {
      const row = await createPending({
        suffix: 'retry-reset',
        pendingExpiresAt: new Date(BASE.getTime() - HOUR),
      });
      const delays = [1, 2, 4, 8, 24] as const;
      let now = BASE;
      for (let prior = 0; prior < 6; prior += 1) {
        const claim = await cleanupFiles.claimNextForDeletion({
          now,
          leaseExpiresAt: new Date(now.getTime() + 10 * 60000),
        });
        expect(claim).toMatchObject({ id: row.id, deleteAttemptCount: prior });
        const nextAttemptAt =
          prior < delays.length
            ? new Date(now.getTime() + delays[prior]! * HOUR)
            : null;
        await expect(
          cleanupFiles.recordDeleteFailure({
            id: row.id,
            claimOwner: claim!.claimOwner,
            attemptCount: prior + 1,
            nextAttemptAt,
            error: 'STORAGE_DELETE_FAILED',
          }),
        ).resolves.toBe(true);
        if (nextAttemptAt !== null) now = nextAttemptAt;
      }
      await expect(
        cleanupFiles.claimNextForDeletion({
          now: new Date(now.getTime() + 30 * 24 * HOUR),
          leaseExpiresAt: new Date(now.getTime() + 30 * 24 * HOUR + 10 * 60000),
        }),
      ).resolves.toBeNull();
      const exhausted = (await files.findExhaustedCleanups()).find(
        (entry) => entry.id === row.id,
      );
      expect(exhausted).toMatchObject({
        deleteAttemptCount: 6,
        lastDeleteError: 'STORAGE_DELETE_FAILED',
      });
      expect(Object.keys(exhausted!).sort()).toEqual([
        'createdAt',
        'deleteAttemptCount',
        'id',
        'lastDeleteError',
      ]);
      const resetAt = new Date(now.getTime() + HOUR);
      await expect(files.resetDeleteAttempts(row.id, resetAt)).resolves.toBe(
        true,
      );
      await expect(
        files
          .findExhaustedCleanups()
          .then((entries) => entries.some((entry) => entry.id === row.id)),
      ).resolves.toBe(false);
      await expect(
        cleanupFiles.claimNextForDeletion({
          now: resetAt,
          leaseExpiresAt: new Date(resetAt.getTime() + 10 * 60000),
        }),
      ).resolves.toMatchObject({ id: row.id, deleteAttemptCount: 0 });
    });
    it('serializes attach versus expiry so exactly one transition wins', async () => {
      const row = await createPending({
        suffix: 'attach-expiry-race',
        pendingExpiresAt: BASE,
        expiresAt: programScheduleService.addOneCalendarYear(BASE),
      });
      const submission = await createSubmissionHistory('attach-expiry-race');
      const [attached, claimed] = await Promise.all([
        prisma.file.updateMany({
          where: {
            kind: 'SUBMISSION',
            id: row.id,
            lifecycle: FileLifecycle.PENDING,
            pendingExpiresAt: { gt: new Date(BASE.getTime() - 1) },
          },
          data: {
            lifecycle: FileLifecycle.ATTACHED,
            pendingExpiresAt: null,
            submissionId: submission.submissionId,
            submissionHistoryId: submission.historyId,
          },
        }),
        cleanupFiles.claimNextForDeletion({
          now: BASE,
          leaseExpiresAt: new Date(BASE.getTime() + 10 * 60000),
        }),
      ]);
      const persisted = await prisma.file.findUniqueOrThrow({
        where: { kind: 'SUBMISSION', id: row.id },
      });
      expect(
        Number(attached.count === 1) + Number(claimed?.id === row.id),
      ).toBe(1);
      expect(persisted.lifecycle).toBe(
        attached.count === 1
          ? FileLifecycle.ATTACHED
          : FileLifecycle.DELETE_PENDING,
      );
    });
    it('저장된 zip MIME이 브라우저 별칭이어도 내려주기는 확장자의 정규 타입이다', async () => {
      const archive = signatureValidZip([{ name: 'plan.pdf' }]);
      const row = await createPending({
        suffix: 'windows-zip-download',
        originalFileName: 'archive.zip',
        mimeType: 'application/x-zip-compressed',
        sizeBytes: archive.byteLength,
      });
      const submission = await createSubmissionHistory('windows-zip-download');
      await storage.put({
        body: archive,
        contentType: 'application/x-zip-compressed',
        originalName: 'archive.zip',
        objectKey: row.storageKey,
      });
      await prisma.file.update({
        where: { kind: 'SUBMISSION', id: row.id },
        data: {
          lifecycle: FileLifecycle.ATTACHED,
          pendingExpiresAt: null,
          submissionId: submission.submissionId,
          submissionHistoryId: submission.historyId,
        },
      });
      const filesService = new FilesService(
        files,
        storage,
        new ProgramScheduleService(),
        new SubmissionFileAdmissionService(),
        new DownloadResponseService(),
      );
      const downloaded = await filesService.download(
        seedGithubId(USER_ID),
        row.id,
        BASE,
      );
      expect(downloaded).toMatchObject({
        fileName: 'archive.zip',
        contentType: 'application/zip',
        contentLength: archive.byteLength,
      });
    });
    it('판정만 하는 요청은 제출과 같은 코드로 거절하고 행·감사·아웃박스·객체를 남기지 않는다', async () => {
      const filesService = new FilesService(
        files,
        storage,
        new ProgramScheduleService(),
        new SubmissionFileAdmissionService(),
        new DownloadResponseService(),
      );
      const zipUpload = (buffer: Buffer) => ({
        buffer,
        originalname: 'plan.zip',
        mimetype: 'application/zip',
        size: buffer.byteLength,
      });
      const rejected = [
        [
          signatureValidZip([
            {
              name: 'plan.txt',
              flags: 0x0001,
              compressedSize: 1 + 12,
              uncompressedSize: 1,
            },
          ]),
          'SUB_028',
        ],
        [signatureValidZip([{ name: 'inner.zip' }]), 'SUB_027'],
      ] as const;
      const before = await persistedFootprint();
      for (const [archive, code] of rejected) {
        const expected = { errorCode: { code, status: 422 } };
        await expect(
          filesService.check(zipUpload(archive)),
        ).rejects.toMatchObject(expected);
      }
      await expect(
        filesService.check(
          zipUpload(signatureValidZip([{ name: 'plan.txt' }])),
        ),
      ).resolves.toBeUndefined();
      await expect(persistedFootprint()).resolves.toEqual(before);
    });
  },
);
