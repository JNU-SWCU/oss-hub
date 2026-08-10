export type CollectionHealth =
  'EMPTY' | 'NORMAL' | 'DELAYED' | 'PARTIAL' | 'FAILED';

export type CurrentRunStatus = 'IDLE' | 'PROCESSING';

export type SystemStatusSafeReason =
  | 'NO_TRACKED_REPOSITORIES'
  | 'UPSTREAM_RATE_LIMITED'
  | 'RUN_INCOMPLETE'
  | 'STALE_DATA';

export interface SystemStatus {
  readonly health: CollectionHealth;
  readonly dataAsOf: string | null;
  readonly trackedRepositoryCount: number;
  readonly readyStreamCount: number;
  readonly backfillingStreamCount: number;
  readonly partialStreamCount: number;
  readonly retryPendingStreamCount: number;
  readonly oldestReadyCheckpointAt: string | null;
  readonly oldestRetryPendingAt: string | null;
  readonly lastCycleStartedAt: string | null;
  readonly lastCycleCompletedAt: string | null;
  /** 다음 예정 수집 사이클 시각. 스케줄이 아직 정해지지 않았으면 null. */
  readonly nextCycleAt: string | null;
  readonly currentRunStatus: CurrentRunStatus;
  readonly safeReason: SystemStatusSafeReason | null;
}

export type CollectionStreamType = 'COMMIT' | 'PULL_REQUEST' | 'RELEASE';

/** 집계 카운트(readyStreamCount 등)와 같은 4구간. */
export type CollectionStreamBucket =
  'READY' | 'BACKFILLING' | 'PARTIAL' | 'RETRY_PENDING';

export interface CollectionStreamDetail {
  readonly streamType: CollectionStreamType;
  readonly bucket: CollectionStreamBucket;
  readonly lastSuccessAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAt: string | null;
}

export interface CollectionStreamRepository {
  readonly repositoryName: string;
  readonly streams: readonly CollectionStreamDetail[];
}

export interface SystemStatusResponse {
  readonly collection: SystemStatus;
  readonly collectionStreams: readonly CollectionStreamRepository[];
}

export interface SystemStatusData {
  readonly status: SystemStatus;
  readonly collectionStreams: readonly CollectionStreamRepository[];
}

export type SystemStatusViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'success';
      readonly status: SystemStatus;
      readonly collectionStreams: readonly CollectionStreamRepository[];
    };

export type TriggerNotice =
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };
