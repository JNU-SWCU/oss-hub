import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  MilestoneSubmissionType,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { runProfile } from '../../prisma/seed';
import { seedGithubId, seedId, SeedStats } from '../../prisma/seeds/helpers';
import { MILESTONE_SCENARIOS } from '../../prisma/seeds/milestones';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { addOneCalendarYear } from '../common/add-one-calendar-year';
import { PrismaService } from '../prisma/prisma.service';
import { S3SubmissionFileStorage } from './s3-submission-file.storage';
import { SubmissionFileStorageConfig } from './submission-file-storage.config';
import { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { signatureValidZip } from './submission-zip-test-builder';

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
const files = new SubmissionFilesRepository(prisma);
const storageConfig = new SubmissionFileStorageConfig();
const storage = new S3SubmissionFileStorage(storageConfig);
const APPLICATION_ID = seedId('milestones', 'application', 'personal');
const USER_ID = seedId('milestones', 'user', 'applicant-personal');
const MILESTONE_ID = MILESTONE_SCENARIOS['milestones-upcoming'][0];
const PREFIX = 'integration/submission-file-lifecycle';
const SUBMISSION_PREFIX = 'integration-submission-file-lifecycle';
const BASE = new Date('2026-07-25T00:00:00.000Z');
const HOUR = 60 * 60 * 1_000;

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

async function createPending(options: {
  suffix: string;
  pendingExpiresAt?: Date;
  expiresAt?: Date;
  originalFileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}) {
  return prisma.submissionFile.create({
    data: {
      uploaderId: USER_ID,
      applicationId: APPLICATION_ID,
      milestoneId: MILESTONE_ID,
      storageKey: `${PREFIX}/${options.suffix}`,
      originalFileName: options.originalFileName ?? 'synthetic.pdf',
      mimeType: options.mimeType ?? 'application/pdf',
      sizeBytes: options.sizeBytes ?? 14,
      lifecycle: SubmissionFileLifecycle.PENDING,
      pendingExpiresAt:
        options.pendingExpiresAt ?? new Date(BASE.getTime() + HOUR),
      expiresAt: options.expiresAt ?? addOneCalendarYear(BASE),
    },
  });
}
async function createSubmissionHistory(
  suffix: string,
): Promise<{ submissionId: string; historyId: string }> {
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
      kind: MilestoneDocumentKind.DOCUMENT,
    },
  });
  await prisma.milestoneDocumentSubmission.create({
    data: {
      id: submissionId,
      milestoneDocumentId: documentId,
      applicationId: APPLICATION_ID,
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
  'submission file lifecycle PostgreSQL + MinIO integration',
  () => {
    beforeAll(async () => {
      await prisma.$connect();
      await runProfile('milestones', new SeedStats());
    });

    afterEach(async () => {
      const rows = await prisma.submissionFile.findMany({
        where: { storageKey: { startsWith: PREFIX } },
        select: { storageKey: true },
      });
      await Promise.all(
        rows.map(({ storageKey }) => storage.delete(storageKey)),
      );
      await prisma.submissionFile.deleteMany({
        where: { storageKey: { startsWith: PREFIX } },
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

    it('performs a real PUT and idempotent delete against MinIO', async () => {
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
      await prisma.submissionFile.update({
        where: { id: row.id },
        data: {
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          pendingExpiresAt: null,
          milestoneDocumentSubmissionId: submission.submissionId,
          milestoneDocumentSubmissionHistoryId: submission.historyId,
        },
      });

      const claimed = await files.claimNextForDeletion({
        now: BASE,
        leaseExpiresAt: new Date(BASE.getTime() + 10 * 60_000),
      });
      expect(claimed).toMatchObject({ id: row.id, storageKey: row.storageKey });
      await storage.delete(row.storageKey);
      await expect(
        files.markDeleted(row.id, claimed!.claimOwner, BASE),
      ).resolves.toBe(true);

      await expect(
        prisma.submissionFile.findUniqueOrThrow({ where: { id: row.id } }),
      ).resolves.toMatchObject({
        lifecycle: SubmissionFileLifecycle.DELETED,
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
      await prisma.submissionFile.update({
        where: { id: row.id },
        data: {
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          pendingExpiresAt: null,
          milestoneDocumentSubmissionId: submission.submissionId,
          milestoneDocumentSubmissionHistoryId: submission.historyId,
        },
      });

      await expect(
        files.claimNextForDeletion({
          now: BASE,
          leaseExpiresAt: new Date(BASE.getTime() + 10 * 60_000),
        }),
      ).resolves.toBeNull();
    });

    it('uses PostgreSQL SKIP LOCKED so two workers cannot claim the same file', async () => {
      const row = await createPending({
        suffix: 'exclusive-claim',
        pendingExpiresAt: new Date(BASE.getTime() - HOUR),
      });

      const claims = await Promise.all([
        files.claimNextForDeletion({
          now: BASE,
          leaseExpiresAt: new Date(BASE.getTime() + 10 * 60_000),
        }),
        files.claimNextForDeletion({
          now: BASE,
          leaseExpiresAt: new Date(BASE.getTime() + 10 * 60_000),
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
      const first = await files.claimNextForDeletion({
        now: BASE,
        leaseExpiresAt: new Date(BASE.getTime() + 10 * 60_000),
      });
      const takeoverAt = new Date(BASE.getTime() + 11 * 60_000);
      const second = await files.claimNextForDeletion({
        now: takeoverAt,
        leaseExpiresAt: new Date(takeoverAt.getTime() + 10 * 60_000),
      });

      expect(second?.id).toBe(row.id);
      expect(second?.claimOwner).not.toBe(first?.claimOwner);
      await expect(
        files.markDeleted(row.id, first!.claimOwner, takeoverAt),
      ).resolves.toBe(false);
      await expect(
        files.recordDeleteFailure({
          id: row.id,
          claimOwner: first!.claimOwner,
          attemptCount: 1,
          nextAttemptAt: new Date(takeoverAt.getTime() + HOUR),
          error: 'STORAGE_DELETE_FAILED',
        }),
      ).resolves.toBe(false);
      await expect(
        files.markDeleted(row.id, second!.claimOwner, takeoverAt),
      ).resolves.toBe(true);
    });

    it('persists retry backoff, exhaustion, and operator reset in PostgreSQL', async () => {
      const row = await createPending({
        suffix: 'retry-reset',
        pendingExpiresAt: new Date(BASE.getTime() - HOUR),
      });
      const delays = [1, 2, 4, 8, 24] as const;
      let now = BASE;

      for (let prior = 0; prior < 6; prior += 1) {
        const claim = await files.claimNextForDeletion({
          now,
          leaseExpiresAt: new Date(now.getTime() + 10 * 60_000),
        });
        expect(claim).toMatchObject({ id: row.id, deleteAttemptCount: prior });
        const nextAttemptAt =
          prior < delays.length
            ? new Date(now.getTime() + delays[prior]! * HOUR)
            : null;
        await expect(
          files.recordDeleteFailure({
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
        files.claimNextForDeletion({
          now: new Date(now.getTime() + 30 * 24 * HOUR),
          leaseExpiresAt: new Date(
            now.getTime() + 30 * 24 * HOUR + 10 * 60_000,
          ),
        }),
      ).resolves.toBeNull();

      // 소진된 행은 스케줄러가 다시 집지 않으므로 운영자 조회에 반드시 떠야 한다(#545).
      const exhausted = (await files.findExhaustedCleanups()).find(
        (entry) => entry.id === row.id,
      );
      expect(exhausted).toMatchObject({
        deleteAttemptCount: 6,
        lastDeleteError: 'STORAGE_DELETE_FAILED',
      });
      // 파일명·저장소 키·업로더는 select 단계에서 이미 빠져 있어야 한다.
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
      // 운영자 재시도로 되살아난 행은 더 이상 소진 목록에 남지 않는다.
      await expect(
        files
          .findExhaustedCleanups()
          .then((entries) => entries.some((entry) => entry.id === row.id)),
      ).resolves.toBe(false);
      await expect(
        files.claimNextForDeletion({
          now: resetAt,
          leaseExpiresAt: new Date(resetAt.getTime() + 10 * 60_000),
        }),
      ).resolves.toMatchObject({ id: row.id, deleteAttemptCount: 0 });
    });

    it('serializes attach versus expiry so exactly one transition wins', async () => {
      const row = await createPending({
        suffix: 'attach-expiry-race',
        pendingExpiresAt: BASE,
        expiresAt: addOneCalendarYear(BASE),
      });
      const submission = await createSubmissionHistory('attach-expiry-race');

      const [attached, claimed] = await Promise.all([
        prisma.submissionFile.updateMany({
          where: {
            id: row.id,
            lifecycle: SubmissionFileLifecycle.PENDING,
            pendingExpiresAt: { gt: new Date(BASE.getTime() - 1) },
          },
          data: {
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            pendingExpiresAt: null,
            milestoneDocumentSubmissionId: submission.submissionId,
            milestoneDocumentSubmissionHistoryId: submission.historyId,
          },
        }),
        files.claimNextForDeletion({
          now: BASE,
          leaseExpiresAt: new Date(BASE.getTime() + 10 * 60_000),
        }),
      ]);
      const persisted = await prisma.submissionFile.findUniqueOrThrow({
        where: { id: row.id },
      });

      expect(
        Number(attached.count === 1) + Number(claimed?.id === row.id),
      ).toBe(1);
      expect(persisted.lifecycle).toBe(
        attached.count === 1
          ? SubmissionFileLifecycle.ATTACHED
          : SubmissionFileLifecycle.DELETE_PENDING,
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
      await prisma.submissionFile.update({
        where: { id: row.id },
        data: {
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          pendingExpiresAt: null,
          milestoneDocumentSubmissionId: submission.submissionId,
          milestoneDocumentSubmissionHistoryId: submission.historyId,
        },
      });

      const filesService = new SubmissionFilesService(files, storage);
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
  },
);
