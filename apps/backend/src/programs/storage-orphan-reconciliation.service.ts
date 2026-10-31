import type {
  ObjectInventoryPort,
  ObjectStoragePort,
} from '../platform/object-storage.types';
import { type StorageReferenceRepository } from './prisma-storage-reference.repository';

export const DEFAULT_STORAGE_ORPHAN_SAFETY_WINDOW_MS = 60 * 60 * 1_000;

export const KNOWN_STORAGE_PREFIXES = [
  'submission-files/',
  'program-authoring/',
  'program-covers/',
] as const;

export type StorageOrphanReconciliationMode = 'report' | 'delete';

interface StoredObjectMetadata {
  readonly key: string;
  readonly lastModified: Date;
}

export interface StorageObjectInventory {
  readonly listObjects: () => Promise<readonly StoredObjectMetadata[]>;
  readonly delete: (key: string) => Promise<void>;
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

interface StorageOrphanClassification {
  readonly orphanKeys: readonly string[];
  readonly recentObjectKeys: readonly string[];
}

function resolveStorageOrphanCutoff(
  runStartedAt: Date,
  safetyWindowMs: number,
): Date {
  if (!Number.isSafeInteger(safetyWindowMs) || safetyWindowMs < 0) {
    throw new Error('Storage orphan safety window must be non-negative');
  }
  return new Date(runStartedAt.getTime() - safetyWindowMs);
}

function assertKnownStorageObjects(
  objects: readonly StoredObjectMetadata[],
): void {
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

function classifyStorageObjects(
  objects: readonly StoredObjectMetadata[],
  liveKeys: ReadonlySet<string>,
  cutoffAt: Date,
): StorageOrphanClassification {
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
  return { orphanKeys, recentObjectKeys };
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

export function parseStorageOrphanReconciliationMode(
  args: readonly string[],
): StorageOrphanReconciliationMode {
  if (args.length === 0 || (args.length === 1 && args[0] === '--report')) {
    return 'report';
  }
  if (args.length === 1 && args[0] === '--delete') return 'delete';
  throw new Error('Exactly one mode is allowed: --report or --delete');
}

export async function runStorageOrphanReconciliation(
  mode: StorageOrphanReconciliationMode,
  references: StorageReferenceRepository,
  objectStorage: ObjectStoragePort,
  objectInventory: ObjectInventoryPort,
): Promise<void> {
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
}
