import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { S3SubmissionFileStorage } from './s3-submission-file.storage';
import { SubmissionFileStorageConfig } from './submission-file-storage.config';
import {
  StorageOrphanReconciliationService,
  type StorageObjectInventory,
} from './storage-orphan-reconciliation';
import { PrismaStorageReferenceRepository } from './storage-orphan-reconciliation.repository';

const INTEGRATION_SENTINEL = 'oss-hub-isolated-integration-v1';
const FIXTURE_PREFIX = 'reconcile-test-qa60';
const USER_ID = `${FIXTURE_PREFIX}-user`;
const PROGRAM_ID = `${FIXTURE_PREFIX}-program`;
const MILESTONE_ID = `${FIXTURE_PREFIX}-milestone`;
const DOCUMENT_ID = `${FIXTURE_PREFIX}-document`;
const SUBMISSION_FILE_ID = `${FIXTURE_PREFIX}-submission-file`;
const AUTHORING_UPLOAD_ID = `${FIXTURE_PREFIX}-authoring-upload`;
const TEMPLATE_FILE_ID = `${FIXTURE_PREFIX}-template-file`;
const PENDING_TOMBSTONE_ID = `${FIXTURE_PREFIX}-pending-tombstone`;
const DELETED_TOMBSTONE_ID = `${FIXTURE_PREFIX}-deleted-tombstone`;

const KEYS = {
  liveSubmission: `submission-files/${FIXTURE_PREFIX}-live-submission`,
  liveAuthoring: `program-authoring/${FIXTURE_PREFIX}-live-authoring`,
  liveTemplate: `submission-files/${FIXTURE_PREFIX}-live-template`,
  pendingTombstone: `submission-files/${FIXTURE_PREFIX}-pending-tombstone`,
  deletedTombstone: `submission-files/${FIXTURE_PREFIX}-deleted-tombstone`,
  orphan: `submission-files/${FIXTURE_PREFIX}-orphan`,
  dbFailure: `submission-files/${FIXTURE_PREFIX}-db-failure`,
  concurrent: `submission-files/${FIXTURE_PREFIX}-concurrent`,
} as const;

const prisma = new PrismaClient();
const config = new SubmissionFileStorageConfig();
const storage = new S3SubmissionFileStorage(config);
const settings = config.requireSettings();
const s3 = new S3Client({
  endpoint: settings.endpoint,
  region: settings.region,
  forcePathStyle: settings.forcePathStyle,
  credentials: {
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
  },
});

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw error;
  }
}

async function putObject(key: string): Promise<void> {
  await storage.put({
    objectKey: key,
    originalName: 'synthetic.txt',
    contentType: 'text/plain',
    body: Buffer.from('synthetic storage reconciliation fixture'),
  });
}

async function clearFixture(): Promise<void> {
  await Promise.all(Object.values(KEYS).map((key) => storage.delete(key)));
  await prisma.programPurgeFileTombstone.deleteMany({
    where: { id: { in: [PENDING_TOMBSTONE_ID, DELETED_TOMBSTONE_ID] } },
  });
  await prisma.milestoneDocumentTemplateFile.deleteMany({
    where: { id: TEMPLATE_FILE_ID },
  });
  await prisma.programAuthoringUpload.deleteMany({
    where: { id: AUTHORING_UPLOAD_ID },
  });
  await prisma.submissionFile.deleteMany({
    where: { id: SUBMISSION_FILE_ID },
  });
  await prisma.milestoneDocument.deleteMany({ where: { id: DOCUMENT_ID } });
  await prisma.milestone.deleteMany({ where: { id: MILESTONE_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

async function installLiveFixture(): Promise<void> {
  await prisma.user.create({
    data: {
      id: USER_ID,
      githubId: 9_060_001n,
      nickname: 'synthetic-reconcile-user',
    },
  });
  await prisma.program.create({
    data: {
      id: PROGRAM_ID,
      name: '합성 스토리지 정합성 프로그램',
      organizer: '합성 운영자',
      category: 'BASIC',
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-01-02T00:00:00.000Z'),
      startAt: new Date('2026-01-03T00:00:00.000Z'),
      endAt: new Date('2026-12-31T00:00:00.000Z'),
      description: '합성 fixture',
    },
  });
  await prisma.milestone.create({
    data: {
      id: MILESTONE_ID,
      programId: PROGRAM_ID,
      name: '합성 마일스톤',
      startAt: new Date('2026-01-03T00:00:00.000Z'),
      dueAt: new Date('2026-02-01T00:00:00.000Z'),
      submissionType: 'FILE',
    },
  });
  await prisma.milestoneDocument.create({
    data: {
      id: DOCUMENT_ID,
      milestoneId: MILESTONE_ID,
      name: '합성 서류',
      required: true,
      sortOrder: 1,
      submissionType: 'FILE',
    },
  });
  await prisma.submissionFile.create({
    data: {
      id: SUBMISSION_FILE_ID,
      uploaderId: USER_ID,
      storageKey: KEYS.liveSubmission,
      originalFileName: 'synthetic.txt',
      mimeType: 'text/plain',
      sizeBytes: 1,
      lifecycle: 'DELETE_PENDING',
    },
  });
  await prisma.programAuthoringUpload.create({
    data: {
      id: AUTHORING_UPLOAD_ID,
      actorId: USER_ID,
      storageKey: KEYS.liveAuthoring,
      originalFileName: 'synthetic.txt',
      mimeType: 'text/plain',
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
      lifecycle: 'PENDING',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    },
  });
  await prisma.milestoneDocumentTemplateFile.create({
    data: {
      id: TEMPLATE_FILE_ID,
      milestoneDocumentId: DOCUMENT_ID,
      storageKey: KEYS.liveTemplate,
      originalFileName: 'synthetic.txt',
      mimeType: 'text/plain',
      sizeBytes: 1,
      uploadedById: USER_ID,
    },
  });
  await Promise.all(
    [
      KEYS.liveSubmission,
      KEYS.liveAuthoring,
      KEYS.liveTemplate,
      KEYS.orphan,
    ].map(putObject),
  );
}

async function installTombstoneFixture(): Promise<void> {
  await prisma.programPurgeFileTombstone.create({
    data: {
      id: PENDING_TOMBSTONE_ID,
      storageKey: KEYS.pendingTombstone,
      lifecycle: 'DELETE_PENDING',
    },
  });
  await prisma.programPurgeFileTombstone.create({
    data: {
      id: DELETED_TOMBSTONE_ID,
      storageKey: KEYS.deletedTombstone,
      lifecycle: 'DELETED',
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  await Promise.all(
    [KEYS.pendingTombstone, KEYS.deletedTombstone].map(putObject),
  );
}

describe('storage orphan reconciliation integration', () => {
  beforeAll(async () => {
    if (process.env.OSS_HUB_INTEGRATION_RUNNER !== INTEGRATION_SENTINEL) {
      throw new Error('isolated integration runner is required');
    }
    await prisma.$connect();
  });

  beforeEach(async () => {
    await clearFixture();
  });

  afterAll(async () => {
    await clearFixture();
    s3.destroy();
    await prisma.$disconnect();
  });

  it('report는 고아 1건만 찾고 delete는 그 객체만 실제로 제거한다', async () => {
    await installLiveFixture();
    const futureRunStart = new Date(Date.now() + 2 * 60 * 60 * 1_000);
    const service = new StorageOrphanReconciliationService(
      new PrismaStorageReferenceRepository(prisma),
      storage,
      () => futureRunStart,
    );

    const report = await service.reconcile({ mode: 'report' });
    expect(report.orphanKeys).toEqual([KEYS.orphan]);
    await expect(objectExists(KEYS.orphan)).resolves.toBe(true);

    const deletion = await service.reconcile({ mode: 'delete' });
    expect(deletion.deletedKeys).toEqual([KEYS.orphan]);
    await expect(objectExists(KEYS.orphan)).resolves.toBe(false);
    await expect(objectExists(KEYS.liveSubmission)).resolves.toBe(true);
    await expect(objectExists(KEYS.liveAuthoring)).resolves.toBe(true);
    await expect(objectExists(KEYS.liveTemplate)).resolves.toBe(true);
  });

  it('DELETE_PENDING tombstone 객체는 고아로 보고되지 않고, DELETED로 finalize된 tombstone 객체는 고아로 보고된다', async () => {
    await installTombstoneFixture();
    const futureRunStart = new Date(Date.now() + 2 * 60 * 60 * 1_000);
    const service = new StorageOrphanReconciliationService(
      new PrismaStorageReferenceRepository(prisma),
      storage,
      () => futureRunStart,
    );

    const pendingReport = await service.reconcile({ mode: 'report' });
    expect(pendingReport.orphanKeys).not.toContain(KEYS.pendingTombstone);
    expect(pendingReport.orphanKeys).toContain(KEYS.deletedTombstone);

    await prisma.programPurgeFileTombstone.update({
      where: { id: PENDING_TOMBSTONE_ID },
      data: { lifecycle: 'DELETED', deletedAt: futureRunStart },
    });

    const finalizedReport = await service.reconcile({ mode: 'report' });
    expect(finalizedReport.orphanKeys).toContain(KEYS.pendingTombstone);
  });

  it('실행 중 업로드는 cutoff 이후 객체로 분류되어 삭제되지 않는다', async () => {
    let signalListingStarted: (() => void) | undefined;
    const listingStarted = new Promise<void>((resolve) => {
      signalListingStarted = resolve;
    });
    let releaseListing: (() => void) | undefined;
    const listingReleased = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });
    const synchronizedStorage: StorageObjectInventory = {
      delete: (key) => storage.delete(key),
      listObjects: async () => {
        signalListingStarted?.();
        await listingReleased;
        return storage.listObjects();
      },
    };
    const runStartedAt = new Date();
    const service = new StorageOrphanReconciliationService(
      new PrismaStorageReferenceRepository(prisma),
      synchronizedStorage,
      () => runStartedAt,
    );

    const run = service.reconcile({ mode: 'delete' });
    await listingStarted;
    await putObject(KEYS.concurrent);
    releaseListing?.();
    const result = await run;

    expect(result.recentObjectKeys).toContain(KEYS.concurrent);
    await expect(objectExists(KEYS.concurrent)).resolves.toBe(true);
  });

  it('DB 연결 실패 시 실제 스토리지 객체를 삭제하지 않는다', async () => {
    await putObject(KEYS.dbFailure);
    const unavailable = new PrismaClient({
      datasources: {
        db: {
          url: 'postgresql://synthetic:synthetic@127.0.0.1:1/synthetic?connect_timeout=1',
        },
      },
    });
    const service = new StorageOrphanReconciliationService(
      new PrismaStorageReferenceRepository(unavailable),
      storage,
    );

    await expect(service.reconcile({ mode: 'delete' })).rejects.toBeDefined();
    await expect(objectExists(KEYS.dbFailure)).resolves.toBe(true);
    await unavailable.$disconnect();
  });
});
