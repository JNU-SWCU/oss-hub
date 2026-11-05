import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  FilesRepository,
  FileCleanupRepository,
  type StorageReferenceRepository,
} from './files.repository';
import { type ObjectStoragePort } from '../platform/object-storage.types';
import { OBJECT_STORAGE } from '../platform/object-storage.config';

@Injectable()
export class FileCleanupRetryService {
  constructor(private readonly files: FilesRepository) {}

  async retry(operatorId: string, fileId: string): Promise<void> {
    const operator = await this.files.findCleanupOperator(operatorId);
    if (
      operator?.hasAdminAccess !== true ||
      operator.accountStatus !== 'ACTIVE'
    ) {
      throw new Error('Operator is not authorized for cleanup maintenance');
    }

    const reset = await this.files.resetDeleteAttempts(fileId, new Date());
    if (!reset) {
      throw new Error('Cleanup retry target is unavailable');
    }
  }
}

const DELETE_LEASE_MS = 10 * 60 * 1_000;
const MAX_DELETE_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [
  60 * 60 * 1_000,
  2 * 60 * 60 * 1_000,
  4 * 60 * 60 * 1_000,
  8 * 60 * 60 * 1_000,
  24 * 60 * 60 * 1_000,
] as const;
const DEFAULT_BATCH_SIZE = 100;

@Injectable()
export class FileCleanupService {
  private readonly logger = new Logger(FileCleanupService.name);
  private running = false;

  constructor(
    @Inject(FileCleanupRepository)
    private readonly files: Pick<
      FileCleanupRepository,
      'claimNextForDeletion' | 'markDeleted' | 'recordDeleteFailure'
    >,
    @Inject(OBJECT_STORAGE)
    private readonly storage: Pick<ObjectStoragePort, 'delete'>,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {}

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'file-cleanup',
  })
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runDue();
    } catch {
      this.logger.error({
        event: 'file.cleanup.run.failed',
        errorCode: 'MAINTENANCE_RUN_FAILED',
      });
    } finally {
      this.running = false;
    }
  }

  async runDue(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    if (!Number.isFinite(batchSize)) return 0;
    const limit = Math.min(
      Math.max(Math.trunc(batchSize), 0),
      DEFAULT_BATCH_SIZE,
    );
    let claimedCount = 0;
    for (let index = 0; index < limit; index += 1) {
      const claimedAt = this.now();
      const file = await this.files.claimNextForDeletion({
        now: claimedAt,
        leaseExpiresAt: new Date(claimedAt.getTime() + DELETE_LEASE_MS),
      });
      if (file === null) break;
      claimedCount += 1;
      await this.deleteClaimed(file);
    }
    return claimedCount;
  }

  private async deleteClaimed(file: {
    id: string;
    storageKey: string;
    deleteAttemptCount: number;
    claimOwner: string;
  }): Promise<void> {
    try {
      await this.storage.delete(file.storageKey);
    } catch {
      const attemptedAt = this.now();
      const attemptCount = file.deleteAttemptCount + 1;
      const delay = RETRY_DELAYS_MS[attemptCount - 1];
      const nextAttemptAt =
        attemptCount < MAX_DELETE_ATTEMPTS && delay !== undefined
          ? new Date(attemptedAt.getTime() + delay)
          : null;
      const recorded = await this.files.recordDeleteFailure({
        id: file.id,
        claimOwner: file.claimOwner,
        attemptCount,
        nextAttemptAt,
        error: 'STORAGE_DELETE_FAILED',
      });
      if (recorded && attemptCount >= MAX_DELETE_ATTEMPTS) {
        this.logger.error({
          event: 'file.cleanup.exhausted',
          fileId: file.id,
          attemptCount,
          error: 'storage_delete_failed',
        });
      }
      return;
    }
    await this.files.markDeleted(file.id, file.claimOwner, this.now());
  }
}

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

@Injectable()
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
