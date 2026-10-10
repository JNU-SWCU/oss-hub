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

  readonly nextCycleAt: string | null;
  readonly currentRunStatus: CurrentRunStatus;
  readonly safeReason: SystemStatusSafeReason | null;
}

export type CollectionStreamType =
  'COMMIT' | 'PULL_REQUEST' | 'RELEASE' | 'ISSUE';

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

  readonly programName: string | null;
  readonly streams: readonly CollectionStreamDetail[];
}

export interface CollectionActivityEntry {
  readonly sweepFinishedAt: string;
  readonly cycleStartedAt: string | null;
  readonly scope: string;

  readonly kind: 'SWEEP' | 'REPOSITORY_LINK';
  readonly insertedCommitCount: number;
  readonly insertedPullRequestCount: number;
  readonly insertedReleaseCount: number;
  readonly insertedIssueCount: number;
  readonly attemptedRepositoryCount: number;
  readonly processedRepositoryCount: number;
  readonly failedRepositoryCount: number;
  readonly cycleCompleted: boolean;
  readonly stoppedForBudget: boolean;
}

export interface ExternalCollectionStatus {
  readonly trackedRepositoryCount: number;
  readonly lastSweep: CollectionActivityEntry | null;
  readonly cumulativeCommitCount: number;
  readonly cumulativePullRequestCount: number;
  readonly cumulativeReleaseCount: number;
  readonly cumulativeIssueCount: number;
}

export type CollectionActivityWire = Omit<
  CollectionActivityEntry,
  'kind' | 'insertedIssueCount'
> &
  Partial<Pick<CollectionActivityEntry, 'kind' | 'insertedIssueCount'>>;

type ExternalCollectionStatusWire = Omit<
  ExternalCollectionStatus,
  'lastSweep' | 'cumulativeIssueCount'
> & {
  readonly lastSweep: CollectionActivityWire | null;
  readonly cumulativeIssueCount?: number;
};

export interface SystemStatusResponse {
  readonly collection: SystemStatus;
  readonly collectionStreams: readonly CollectionStreamRepository[];

  readonly collectionActivity?: readonly CollectionActivityWire[];

  readonly externalCollection?: ExternalCollectionStatusWire;
}

export interface SystemStatusData {
  readonly status: SystemStatus;
  readonly collectionStreams: readonly CollectionStreamRepository[];
  readonly collectionActivity: readonly CollectionActivityEntry[];
  readonly externalCollection: ExternalCollectionStatus;
}

export type SystemStatusViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'success';
      readonly status: SystemStatus;
      readonly collectionStreams: readonly CollectionStreamRepository[];
      readonly collectionActivity: readonly CollectionActivityEntry[];
      readonly externalCollection: ExternalCollectionStatus;
    };

export type TriggerNotice =
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };
