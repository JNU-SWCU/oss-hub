import {
  assertKnownStorageObjects,
  classifyStorageObjects,
  DEFAULT_STORAGE_ORPHAN_SAFETY_WINDOW_MS,
  resolveStorageOrphanCutoff,
  type StorageObjectInventory,
  type StorageOrphanReconciliationOptions,
  type StorageOrphanReconciliationResult,
  type StorageReferenceRepository,
  KNOWN_STORAGE_PREFIXES,
  type StorageOrphanReconciliationMode,
} from './storage-orphan-reconciliation.policy';
import type { INestApplicationContext } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { NestFactory } from '@nestjs/core';
import {
  OBJECT_INVENTORY,
  OBJECT_STORAGE,
  type ObjectInventoryPort,
  type ObjectStoragePort,
} from '../platform/object-storage.types';
import { createStorageReferenceRepository } from './prisma-storage-reference.repository';

export class StorageOrphanReconciliationService {
  constructor(
    private readonly references: StorageReferenceRepository,
    private readonly storage: StorageObjectInventory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(
    options: StorageOrphanReconciliationOptions,
  ): Promise<StorageOrphanReconciliationResult> {
    const runStartedAt = this.now();
    const cutoffAt = resolveStorageOrphanCutoff(
      runStartedAt,
      options.safetyWindowMs ?? DEFAULT_STORAGE_ORPHAN_SAFETY_WINDOW_MS,
    );

    const liveKeys = await this.references.loadLiveKeys();
    const objects = await this.storage.listObjects();
    assertKnownStorageObjects(objects);

    const { orphanKeys, recentObjectKeys } = classifyStorageObjects(
      objects,
      liveKeys,
      cutoffAt,
    );

    const deletedKeys: string[] = [];
    const skippedReferencedKeys: string[] = [];
    if (options.mode === 'delete') {
      await options.onDeletePlan?.(orphanKeys);
      for (const key of orphanKeys) {
        if (await this.references.isLiveKey(key)) {
          skippedReferencedKeys.push(key);
          continue;
        }
        await this.storage.delete(key);
        deletedKeys.push(key);
      }
    }

    return {
      mode: options.mode,
      runStartedAt,
      cutoffAt,
      orphanKeys,
      recentObjectKeys,
      deletedKeys,
      skippedReferencedKeys,
    };
  }
}

export async function runStorageOrphanReconciliation(
  mode: StorageOrphanReconciliationMode,
): Promise<void> {
  const { references, disconnect } = createStorageReferenceRepository();
  let context: INestApplicationContext | undefined;

  try {
    context = await NestFactory.createApplicationContext(PlatformModule, {
      logger: false,
      abortOnError: false,
    });
    const objectStorage = context.get<ObjectStoragePort>(OBJECT_STORAGE);
    const objectInventory = context.get<ObjectInventoryPort>(OBJECT_INVENTORY);
    const inventory: StorageObjectInventory = {
      listObjects: () => objectInventory.listObjects(KNOWN_STORAGE_PREFIXES),
      delete: (key) => objectStorage.delete(key),
    };
    const reconciliation = new StorageOrphanReconciliationService(
      references,
      inventory,
    );

    const result = await reconciliation.reconcile({
      mode,
      onDeletePlan: (keys) => {
        process.stdout.write(
          `${JSON.stringify({ event: 'storage-orphan.delete-plan', keys })}\n`,
        );
      },
    });
    process.stdout.write(
      `${JSON.stringify({
        event: 'storage-orphan.result',
        mode: result.mode,
        runStartedAt: result.runStartedAt.toISOString(),
        cutoffAt: result.cutoffAt.toISOString(),
        orphanKeys: result.orphanKeys,
        recentObjectCount: result.recentObjectKeys.length,
        deletedKeys: result.deletedKeys,
        skippedReferencedKeys: result.skippedReferencedKeys,
      })}\n`,
    );
  } finally {
    try {
      await disconnect();
    } finally {
      await context?.close();
    }
  }
}
