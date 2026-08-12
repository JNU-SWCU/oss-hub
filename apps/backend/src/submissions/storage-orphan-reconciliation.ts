export const DEFAULT_STORAGE_ORPHAN_SAFETY_WINDOW_MS = 60 * 60 * 1_000;

const KNOWN_STORAGE_PREFIXES = [
  'submission-files/',
  'program-authoring/',
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

    // DB를 가장 먼저 읽는다. 연결 또는 소유 모델 중 하나의 조회라도 실패하면
    // storage listing과 삭제에 도달하지 않는 fail-closed 경계다.
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
      // 운영 evidence에 삭제 예정 key 목록이 실제 side effect보다 먼저 기록되도록 한다.
      await options.onDeletePlan?.(orphanKeys);
      for (const key of orphanKeys) {
        // listing 이후 생긴 DB 참조를 삭제 직전 소유 모델 전체에서 다시 확인한다.
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
