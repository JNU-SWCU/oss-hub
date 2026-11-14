export type CollectionHealth = 'EMPTY' | 'NORMAL' | 'DELAYED';

export type CurrentRunStatus = 'IDLE' | 'PROCESSING';

export type SystemStatusSafeReason = 'NO_TRACKED_REPOSITORIES' | 'STALE_DATA';

export interface SystemStatus {
  readonly health: CollectionHealth;
  readonly trackedRepositoryCount: number;
  readonly staleRepositoryCount: number;
  readonly lastSuccessAt: string | null;
  readonly nextCycleAt: string | null;
  readonly currentRunStatus: CurrentRunStatus;
  readonly safeReason: SystemStatusSafeReason | null;
}

export interface CollectionRepositoryStatus {
  readonly repositoryName: string;
  readonly programName: string | null;
  readonly lastSuccessAt: string | null;
  readonly stale: boolean;
}

export interface ExternalCollectionStatus {
  readonly trackedRepositoryCount: number;
  readonly lastSuccessAt: string | null;
}

export interface SystemStatusResponse {
  readonly collection: SystemStatus;
  readonly collectionRepositories: readonly CollectionRepositoryStatus[];

  readonly externalCollection?: ExternalCollectionStatus;
}

export interface SystemStatusData {
  readonly status: SystemStatus;
  readonly collectionRepositories: readonly CollectionRepositoryStatus[];
  readonly externalCollection: ExternalCollectionStatus;
}

export type SystemStatusViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'success';
      readonly freshness: 'current' | 'refreshing' | 'stale';
      readonly status: SystemStatus;
      readonly collectionRepositories: readonly CollectionRepositoryStatus[];
      readonly externalCollection: ExternalCollectionStatus;
    };

export type TriggerNotice =
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };
