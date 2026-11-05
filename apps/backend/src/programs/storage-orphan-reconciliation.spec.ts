import type { StorageReferenceTransactionClient } from './files.repository';
import { Prisma } from '@prisma/client';
import {
  StorageOrphanReconciliationService,
  DEFAULT_STORAGE_ORPHAN_SAFETY_WINDOW_MS,
  type StorageObjectInventory,
} from './file-cleanup.service';
import {
  PrismaStorageReferenceRepository,
  type StorageReferenceRepository,
} from './files.repository';
import { STORAGE_KEY_OWNERS } from './files.config';

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
  it('표지 객체는 live 참조를 보존하고 고아 객체만 삭제한다', async () => {
    const db = references(['program-covers/live']);
    const storage = inventory([
      { key: 'program-covers/live', lastModified: OLD },
      { key: 'program-covers/orphan', lastModified: OLD },
    ]);
    const service = new StorageOrphanReconciliationService(
      db,
      storage,
      () => RUN_STARTED_AT,
    );

    const result = await service.reconcile({ mode: 'delete' });

    expect(result.deletedKeys).toEqual(['program-covers/orphan']);
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith('program-covers/orphan');
  });

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

  it('reads all file kinds from a separate RepeatableRead transaction for each call', async () => {
    const keys = [
      'submission-files/live-submission',
      'program-authoring/live-upload',
      'program-covers/live',
      'submission-files/live-template',
      'submission-files/live-tombstone',
    ];
    const loadTransaction = {
      file: {
        findMany: jest
          .fn()
          .mockResolvedValue(keys.map((storageKey) => ({ storageKey }))),
        findFirst: jest.fn(),
      },
    };
    const liveTransaction = {
      file: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 'cover' }),
      },
    };
    const rootFile = { findMany: jest.fn(), findFirst: jest.fn() };
    const clients = [loadTransaction, liveTransaction];
    const options: Prisma.TransactionIsolationLevel[] = [];
    const prisma = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $transaction<T>(
        operation: (client: StorageReferenceTransactionClient) => Promise<T>,
        input: { readonly isolationLevel: Prisma.TransactionIsolationLevel },
      ) {
        const client = clients.shift();
        if (client === undefined) throw new Error('Unexpected transaction');
        options.push(input.isolationLevel);
        return operation(client);
      },
      file: rootFile,
    };
    const repository = new PrismaStorageReferenceRepository(prisma);

    await expect(repository.loadLiveKeys()).resolves.toEqual(new Set(keys));
    await expect(repository.isLiveKey('program-covers/live')).resolves.toBe(
      true,
    );

    expect(options).toEqual([
      Prisma.TransactionIsolationLevel.RepeatableRead,
      Prisma.TransactionIsolationLevel.RepeatableRead,
    ]);
    expect(loadTransaction.file.findMany).toHaveBeenCalledWith({
      where: { lifecycle: { not: 'DELETED' } },
      select: { storageKey: true },
    });
    expect(liveTransaction.file.findFirst).toHaveBeenCalledWith({
      where: {
        storageKey: 'program-covers/live',
        lifecycle: { not: 'DELETED' },
      },
      select: { id: true },
    });
    expect(rootFile.findMany).not.toHaveBeenCalled();
    expect(rootFile.findFirst).not.toHaveBeenCalled();
  });

  it('excludes completed File deletions from the live-key recheck', async () => {
    const transaction = {
      file: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const prisma = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $transaction<T>(
        operation: (client: StorageReferenceTransactionClient) => Promise<T>,
      ) {
        return operation(transaction);
      },
    };
    const repository = new PrismaStorageReferenceRepository(prisma);

    await expect(
      repository.isLiveKey('submission-files/pending-tombstone'),
    ).resolves.toBe(false);

    expect(transaction.file.findFirst).toHaveBeenCalledWith({
      where: {
        storageKey: 'submission-files/pending-tombstone',
        lifecycle: { not: 'DELETED' },
      },
      select: { id: true },
    });
  });
});
