export const DEFAULT_STORAGE_ORPHAN_SAFETY_WINDOW_MS = 60 * 60 * 1_000;

export const KNOWN_STORAGE_PREFIXES = [
  'submission-files/',
  'program-authoring/',
  'program-covers/',
] as const;

export type StorageOrphanReconciliationMode = 'report' | 'delete';

export interface StoredObjectMetadata {
  readonly key: string;
  readonly lastModified: Date;
}

export interface StorageObjectInventory {
  readonly listObjects: () => Promise<readonly StoredObjectMetadata[]>;
  readonly delete: (key: string) => Promise<void>;
}

export interface StorageReferenceRepository {
  readonly loadLiveKeys: () => Promise<ReadonlySet<string>>;
  readonly isLiveKey: (key: string) => Promise<boolean>;
}

export interface StorageOrphanReconciliationResult {
  readonly mode: StorageOrphanReconciliationMode;
  readonly runStartedAt: Date;
  readonly cutoffAt: Date;
  readonly orphanKeys: readonly string[];
  readonly recentObjectKeys: readonly string[];
  readonly deletedKeys: readonly string[];
  readonly skippedReferencedKeys: readonly string[];
}

export interface StorageOrphanReconciliationOptions {
  readonly mode: StorageOrphanReconciliationMode;
  readonly safetyWindowMs?: number;
  readonly onDeletePlan?: (keys: readonly string[]) => void | Promise<void>;
}

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
    const safetyWindowMs =
      options.safetyWindowMs ?? DEFAULT_STORAGE_ORPHAN_SAFETY_WINDOW_MS;
    if (!Number.isSafeInteger(safetyWindowMs) || safetyWindowMs < 0) {
      throw new Error('Storage orphan safety window must be non-negative');
    }
    const cutoffAt = new Date(runStartedAt.getTime() - safetyWindowMs);

    const liveKeys = await this.references.loadLiveKeys();
    const objects = await this.storage.listObjects();
    this.assertKnownObjects(objects);

    const recentObjectKeys: string[] = [];
    const orphanKeys: string[] = [];
    for (const object of objects) {
      if (object.lastModified.getTime() >= cutoffAt.getTime()) {
        recentObjectKeys.push(object.key);
      } else if (!liveKeys.has(object.key)) {
        orphanKeys.push(object.key);
      }
    }
    recentObjectKeys.sort();
    orphanKeys.sort();

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

  private assertKnownObjects(objects: readonly StoredObjectMetadata[]): void {
    for (const object of objects) {
      if (
        !KNOWN_STORAGE_PREFIXES.some((prefix) => object.key.startsWith(prefix))
      ) {
        throw new Error('Unknown storage object prefix');
      }
      if (Number.isNaN(object.lastModified.getTime())) {
        throw new Error('Storage object has invalid modification time');
      }
    }
  }
}
