import { Prisma } from '@prisma/client';
import {
  DEFAULT_STORAGE_ORPHAN_SAFETY_WINDOW_MS,
  StorageOrphanReconciliationService,
  type StorageObjectInventory,
  type StorageReferenceRepository,
} from './storage-orphan-reconciliation';
import {
  PrismaStorageReferenceRepository,
  STORAGE_KEY_OWNERS,
} from './storage-orphan-reconciliation.repository';
import { parseStorageOrphanReconciliationMode } from './cli/reconcile-storage-orphans';

const OLD = new Date('2026-08-12T00:00:00.000Z');
const RUN_STARTED_AT = new Date('2026-08-12T02:00:00.000Z');

function references(
  liveKeys: string[],
): jest.Mocked<StorageReferenceRepository> {
  const keys = new Set(liveKeys);
  return {
    loadLiveKeys: jest.fn().mockResolvedValue(keys),
    isLiveKey: jest.fn((key: string) => Promise.resolve(keys.has(key))),
  };
}

function inventory(
  objects: Array<{ key: string; lastModified: Date }>,
): jest.Mocked<StorageObjectInventory> {
  return {
    listObjects: jest.fn().mockResolvedValue(objects),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

describe('StorageOrphanReconciliationService', () => {
  it('기본 report 모드는 세 소유 모델의 live key를 보존하고 고아만 보고한다', async () => {
    const db = references([
      'submission-files/live-submission',
      'program-authoring/live-upload',
      'submission-files/live-template',
    ]);
    const storage = inventory([
      { key: 'submission-files/live-submission', lastModified: OLD },
      { key: 'program-authoring/live-upload', lastModified: OLD },
      { key: 'submission-files/live-template', lastModified: OLD },
      { key: 'submission-files/orphan', lastModified: OLD },
    ]);
    const service = new StorageOrphanReconciliationService(
      db,
      storage,
      () => RUN_STARTED_AT,
    );

    const result = await service.reconcile({ mode: 'report' });

    expect(result.orphanKeys).toEqual(['submission-files/orphan']);
    expect(result.deletedKeys).toEqual([]);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('--delete에서 삭제 계획을 먼저 내보낸 뒤 고아만 재조회하고 삭제한다', async () => {
    const db = references(['submission-files/live']);
    const storage = inventory([
      { key: 'submission-files/live', lastModified: OLD },
      { key: 'submission-files/orphan', lastModified: OLD },
    ]);
    const deletePlans: string[][] = [];
    const service = new StorageOrphanReconciliationService(
      db,
      storage,
      () => RUN_STARTED_AT,
    );

    const result = await service.reconcile({
      mode: 'delete',
      onDeletePlan: (keys) => {
        deletePlans.push([...keys]);
      },
    });

    expect(deletePlans).toEqual([['submission-files/orphan']]);
    expect(db.isLiveKey).toHaveBeenCalledWith('submission-files/orphan');
    expect(db.isLiveKey.mock.invocationCallOrder[0]).toBeLessThan(
      storage.delete.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(storage.delete).toHaveBeenCalledWith('submission-files/orphan');
    expect(result.deletedKeys).toEqual(['submission-files/orphan']);
  });

  it('실행 중 업로드된 객체는 run-start cutoff 안전 윈도우로 제외한다', async () => {
    let releaseListing: (() => void) | undefined;
    const listingStarted = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });
    let finishListing: (() => void) | undefined;
    const listingMayFinish = new Promise<void>((resolve) => {
      finishListing = resolve;
    });
    const db = references([]);
    const storage = inventory([]);
    storage.listObjects.mockImplementation(async () => {
      releaseListing?.();
      await listingMayFinish;
      return [
        {
          key: 'submission-files/uploaded-during-run',
          lastModified: new Date(RUN_STARTED_AT.getTime() + 1),
        },
      ];
    });
    const service = new StorageOrphanReconciliationService(
      db,
      storage,
      () => RUN_STARTED_AT,
    );

    const run = service.reconcile({ mode: 'delete' });
    await listingStarted;
    finishListing?.();
    const result = await run;

    expect(result.recentObjectKeys).toEqual([
      'submission-files/uploaded-during-run',
    ]);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('초기 DB 연결/조회 실패 시 storage를 조회하거나 삭제하지 않는다', async () => {
    const db = references([]);
    db.loadLiveKeys.mockRejectedValue(new Error('db unavailable'));
    const storage = inventory([
      { key: 'submission-files/orphan', lastModified: OLD },
    ]);
    const service = new StorageOrphanReconciliationService(
      db,
      storage,
      () => RUN_STARTED_AT,
    );

    await expect(service.reconcile({ mode: 'delete' })).rejects.toThrow(
      'db unavailable',
    );

    expect(storage.listObjects).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('알 수 없는 prefix가 하나라도 있으면 전체 실행을 거부한다', async () => {
    const db = references([]);
    const storage = inventory([
      { key: 'submission-files/orphan', lastModified: OLD },
      { key: 'unknown-prefix/object', lastModified: OLD },
    ]);
    const service = new StorageOrphanReconciliationService(
      db,
      storage,
      () => RUN_STARTED_AT,
    );

    await expect(service.reconcile({ mode: 'delete' })).rejects.toThrow(
      'Unknown storage object prefix',
    );

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('삭제 직전 참조가 생긴 key는 삭제하지 않는다', async () => {
    const db = references([]);
    db.isLiveKey.mockResolvedValue(true);
    const storage = inventory([
      { key: 'submission-files/concurrent-reference', lastModified: OLD },
    ]);
    const service = new StorageOrphanReconciliationService(
      db,
      storage,
      () => RUN_STARTED_AT,
    );

    const result = await service.reconcile({ mode: 'delete' });

    expect(result.skippedReferencedKeys).toEqual([
      'submission-files/concurrent-reference',
    ]);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('기본 안전 윈도우는 run start 이전 1시간이다', () => {
    expect(DEFAULT_STORAGE_ORPHAN_SAFETY_WINDOW_MS).toBe(60 * 60 * 1_000);
  });
});

describe('PrismaStorageReferenceRepository', () => {
  it('Prisma schema의 storageKey 소유 모델 전부가 원장에 있다', () => {
    const schemaOwners = Prisma.dmmf.datamodel.models
      .filter((model) =>
        model.fields.some((field) => field.name === 'storageKey'),
      )
      .map((model) => model.name)
      .sort();

    expect([...STORAGE_KEY_OWNERS].sort()).toEqual(schemaOwners);
  });

  it('DELETED가 아닌 네 모델의 key를 합집합으로 읽고 삭제 직전에도 넷 모두 재조회한다', async () => {
    const prisma = {
      $connect: jest.fn().mockResolvedValue(undefined),
      submissionFile: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { storageKey: 'submission-files/live-submission' },
          ]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      programAuthoringUpload: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ storageKey: 'program-authoring/live-upload' }]),
        findFirst: jest.fn().mockResolvedValue({ id: 'upload' }),
      },
      milestoneDocumentTemplateFile: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { storageKey: 'submission-files/live-template' },
          ]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      programPurgeFileTombstone: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { storageKey: 'submission-files/live-tombstone' },
          ]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const repository = new PrismaStorageReferenceRepository(prisma as never);

    await expect(repository.loadLiveKeys()).resolves.toEqual(
      new Set([
        'submission-files/live-submission',
        'program-authoring/live-upload',
        'submission-files/live-template',
        'submission-files/live-tombstone',
      ]),
    );
    await expect(
      repository.isLiveKey('program-authoring/live-upload'),
    ).resolves.toBe(true);

    expect(prisma.submissionFile.findMany).toHaveBeenCalledWith({
      where: { lifecycle: { not: 'DELETED' } },
      select: { storageKey: true },
    });
    expect(prisma.programAuthoringUpload.findMany).toHaveBeenCalledWith({
      where: { lifecycle: { not: 'DELETED' } },
      select: { storageKey: true },
    });
    expect(prisma.milestoneDocumentTemplateFile.findMany).toHaveBeenCalledWith({
      select: { storageKey: true },
    });
    expect(prisma.programPurgeFileTombstone.findMany).toHaveBeenCalledWith({
      where: { lifecycle: { not: 'DELETED' } },
      select: { storageKey: true },
    });
    expect(prisma.submissionFile.findFirst).toHaveBeenCalled();
    expect(prisma.programAuthoringUpload.findFirst).toHaveBeenCalled();
    expect(prisma.milestoneDocumentTemplateFile.findFirst).toHaveBeenCalled();
    expect(prisma.programPurgeFileTombstone.findFirst).toHaveBeenCalled();
  });

  it('tombstone이 DELETE_PENDING이면 live로 취급하고 DELETED가 되면 제외한다', async () => {
    const prisma = {
      $connect: jest.fn().mockResolvedValue(undefined),
      submissionFile: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      programAuthoringUpload: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      milestoneDocumentTemplateFile: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      programPurgeFileTombstone: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const repository = new PrismaStorageReferenceRepository(prisma as never);

    await repository.isLiveKey('submission-files/pending-tombstone');

    expect(prisma.programPurgeFileTombstone.findFirst).toHaveBeenCalledWith({
      where: {
        storageKey: 'submission-files/pending-tombstone',
        lifecycle: { not: 'DELETED' },
      },
      select: { id: true },
    });
  });
});

describe('reconcile-storage-orphans CLI arguments', () => {
  it('인자 없음과 --report는 report이고 삭제는 --delete만 허용한다', () => {
    expect(parseStorageOrphanReconciliationMode([])).toBe('report');
    expect(parseStorageOrphanReconciliationMode(['--report'])).toBe('report');
    expect(parseStorageOrphanReconciliationMode(['--delete'])).toBe('delete');
    expect(() =>
      parseStorageOrphanReconciliationMode(['--report', '--delete']),
    ).toThrow('Exactly one mode');
    expect(() => parseStorageOrphanReconciliationMode(['--force'])).toThrow(
      'Exactly one mode',
    );
  });
});
