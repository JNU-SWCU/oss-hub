export type CollectionHealth = 'NORMAL' | 'DELAYED' | 'FAILED';

export type CurrentRunStatus = 'IDLE' | 'PENDING' | 'PROCESSING';

export type SystemStatusSafeReason =
  | 'NO_COMPLETE_DATA'
  | 'INSTALLATION_INVALID'
  | 'PERMISSION_INVALID'
  | 'STALE_DATA'
  | 'RUN_INCOMPLETE'
  | 'UPSTREAM_RATE_LIMITED'
  | 'RUN_FAILED';

export interface SystemStatus {
  readonly health: CollectionHealth;
  readonly lastCompleteSuccessAt: string | null;
  readonly dataAsOf: string | null;
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
