export type CollectionHealthResult =
  'EMPTY' | 'NORMAL' | 'DELAYED' | 'PARTIAL' | 'FAILED';

export type CurrentRunStatusResult = 'IDLE' | 'PROCESSING';

export type SystemStatusSafeReasonResult =
  | 'NO_TRACKED_REPOSITORIES'
  | 'UPSTREAM_RATE_LIMITED'
  | 'RUN_INCOMPLETE'
  | 'STALE_DATA';

interface CollectionSystemStatusResult {
  readonly health: CollectionHealthResult;
  readonly dataAsOf: Date | null;
  readonly trackedRepositoryCount: number;
  readonly readyStreamCount: number;
  readonly backfillingStreamCount: number;
  readonly partialStreamCount: number;
  readonly retryPendingStreamCount: number;
  readonly oldestReadyCheckpointAt: Date | null;
  readonly oldestRetryPendingAt: Date | null;
  readonly lastCycleStartedAt: Date | null;
  readonly lastCycleCompletedAt: Date | null;
  readonly nextCycleAt: Date | null;
  readonly currentRunStatus: CurrentRunStatusResult;
  readonly safeReason: SystemStatusSafeReasonResult | null;
}

interface RepositoryProvisioningSystemStatusResult {
  readonly finalFailureCount: number;
}

type CollectionStreamBucketResult =
  'READY' | 'BACKFILLING' | 'PARTIAL' | 'RETRY_PENDING';

type CollectionStreamTypeResult =
  'COMMIT' | 'PULL_REQUEST' | 'RELEASE' | 'ISSUE';

interface CollectionRepositoryStreamResult {
  readonly streamType: CollectionStreamTypeResult;
  readonly bucket: CollectionStreamBucketResult;
  readonly lastSuccessAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAt: Date | null;
}

interface SystemStatusCollectionStreamsResult {
  readonly repositoryName: string;
  readonly programName: string | null;
  readonly streams: readonly CollectionRepositoryStreamResult[];
}

export interface SystemStatusCollectionActivityResult {
  readonly sweepFinishedAt: Date;
  readonly cycleStartedAt: Date | null;
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

interface SystemStatusExternalCollectionResult {
  readonly trackedRepositoryCount: number;
  readonly lastSweep: SystemStatusCollectionActivityResult | null;
  readonly cumulativeCommitCount: number;
  readonly cumulativePullRequestCount: number;
  readonly cumulativeReleaseCount: number;
  readonly cumulativeIssueCount: number;
}

export interface SystemStatusResult {
  readonly collection: CollectionSystemStatusResult;
  readonly repositoryProvisioning: RepositoryProvisioningSystemStatusResult;
  readonly collectionStreams: readonly SystemStatusCollectionStreamsResult[];
  readonly collectionActivity: readonly SystemStatusCollectionActivityResult[];
  readonly externalCollection: SystemStatusExternalCollectionResult;
}
