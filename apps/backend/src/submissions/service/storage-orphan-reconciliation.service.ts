import {
  assertKnownStorageObjects,
  classifyStorageObjects,
  DEFAULT_STORAGE_ORPHAN_SAFETY_WINDOW_MS,
  resolveStorageOrphanCutoff,
  type StorageObjectInventory,
  type StorageOrphanReconciliationOptions,
  type StorageOrphanReconciliationResult,
  type StorageReferenceRepository,
} from '../domain/storage-orphan-reconciliation';

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
