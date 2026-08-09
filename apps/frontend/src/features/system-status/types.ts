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
  readonly currentRunStatus: CurrentRunStatus;
  readonly safeReason: SystemStatusSafeReason | null;
}
export interface SystemStatusResponse {
  readonly collection: SystemStatus;
}

export type SystemStatusViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'success'; readonly status: SystemStatus };

export type TriggerNotice =
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };
