import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  OBJECT_INVENTORY,
  OBJECT_STORAGE,
  type ObjectInventoryPort,
  type ObjectStoragePort,
} from '../../storage/domain/object-storage';
import { StorageModule } from '../../storage/storage.module';
import {
  KNOWN_STORAGE_PREFIXES,
  type StorageObjectInventory,
  type StorageOrphanReconciliationMode,
} from '../domain/storage-orphan-reconciliation';
import { createStorageReferenceRepository } from '../repository/storage-orphan-reconciliation.repository';
import { StorageOrphanReconciliationService } from './storage-orphan-reconciliation.service';

export async function runStorageOrphanReconciliation(
  mode: StorageOrphanReconciliationMode,
): Promise<void> {
  const { references, disconnect } = createStorageReferenceRepository();
  let context: INestApplicationContext | undefined;

  try {
    context = await NestFactory.createApplicationContext(StorageModule, {
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
