import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  OBJECT_INVENTORY,
  OBJECT_STORAGE,
} from '../../storage/domain/object-storage';
import { StorageModule } from '../../storage/storage.module';
import { KNOWN_STORAGE_PREFIXES } from '../domain/storage-orphan-reconciliation';
import { createStorageReferenceRepository } from '../repository/storage-orphan-reconciliation.repository';
import { runStorageOrphanReconciliation } from './storage-orphan-reconciliation.runner';

jest.mock('../repository/storage-orphan-reconciliation.repository', () => ({
  createStorageReferenceRepository: jest.fn(),
}));

describe('storage orphan reconciliation runner', () => {
  const runStartedAt = new Date('2026-08-12T02:00:00.000Z');
  const references = {
    loadLiveKeys: jest.fn(),
    isLiveKey: jest.fn(),
  };
  const disconnect = jest.fn<Promise<void>, []>();
  const close = jest.fn<Promise<void>, []>();
  const storage = { delete: jest.fn<Promise<void>, [string]>() };
  const inventory = { listObjects: jest.fn() };
  const context = {
    get: jest.fn((key: symbol) => {
      if (key === OBJECT_STORAGE) return storage;
      if (key === OBJECT_INVENTORY) return inventory;
      throw new Error('Unexpected provider');
    }),
    close,
  };
  let output: string[];
  let bootstrap: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(runStartedAt);
    references.loadLiveKeys.mockResolvedValue(new Set());
    references.isLiveKey.mockResolvedValue(false);
    disconnect.mockResolvedValue(undefined);
    close.mockResolvedValue(undefined);
    storage.delete.mockResolvedValue(undefined);
    inventory.listObjects.mockResolvedValue([
      {
        key: 'submission-files/orphan',
        lastModified: new Date('2026-08-12T00:00:00.000Z'),
      },
    ]);
    jest.mocked(createStorageReferenceRepository).mockReturnValue({
      references,
      disconnect,
    });
    bootstrap = jest
      .spyOn(NestFactory, 'createApplicationContext')
      .mockResolvedValue(context as unknown as INestApplicationContext);
    output = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('reports without deleting and preserves the exact JSON event contract', async () => {
    await runStorageOrphanReconciliation('report');

    expect(bootstrap).toHaveBeenCalledWith(StorageModule, {
      logger: false,
      abortOnError: false,
    });
    expect(inventory.listObjects).toHaveBeenCalledWith(KNOWN_STORAGE_PREFIXES);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(output).toEqual([
      `${JSON.stringify({
        event: 'storage-orphan.result',
        mode: 'report',
        runStartedAt: '2026-08-12T02:00:00.000Z',
        cutoffAt: '2026-08-12T01:00:00.000Z',
        orphanKeys: ['submission-files/orphan'],
        recentObjectCount: 0,
        deletedKeys: [],
        skippedReferencedKeys: [],
      })}\n`,
    ]);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('emits the deletion plan before deleting and then emits the result', async () => {
    storage.delete.mockImplementation(() => {
      expect(output).toEqual([
        '{"event":"storage-orphan.delete-plan","keys":["submission-files/orphan"]}\n',
      ]);
      return Promise.resolve();
    });

    await runStorageOrphanReconciliation('delete');

    expect(storage.delete).toHaveBeenCalledWith('submission-files/orphan');
    expect(output).toHaveLength(2);
    expect(JSON.parse(output[1] ?? '')).toMatchObject({
      event: 'storage-orphan.result',
      mode: 'delete',
      deletedKeys: ['submission-files/orphan'],
    });
  });

  it('disconnects the repository when storage bootstrap fails', async () => {
    const error = new Error('synthetic bootstrap failure');
    bootstrap.mockRejectedValueOnce(error);

    await expect(runStorageOrphanReconciliation('report')).rejects.toBe(error);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(output).toEqual([]);
  });

  it('closes both resources without emitting success when reference loading fails', async () => {
    const error = new Error('synthetic database failure');
    references.loadLiveKeys.mockRejectedValueOnce(error);

    await expect(runStorageOrphanReconciliation('delete')).rejects.toBe(error);
    expect(inventory.listObjects).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(output).toEqual([]);
  });

  it('still closes the application context if repository disconnect fails', async () => {
    const error = new Error('synthetic disconnect failure');
    disconnect.mockRejectedValueOnce(error);

    await expect(runStorageOrphanReconciliation('report')).rejects.toBe(error);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
