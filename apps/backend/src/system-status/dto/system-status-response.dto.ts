export const COLLECTION_HEALTH_VALUES = [
  'EMPTY',
  'NORMAL',
  'DELAYED',
  'PARTIAL',
  'FAILED',
] as const;
export type CollectionHealthResponseDto =
  (typeof COLLECTION_HEALTH_VALUES)[number];

export const CURRENT_RUN_STATUS_VALUES = ['IDLE', 'PROCESSING'] as const;
export type CurrentRunStatusResponseDto =
  (typeof CURRENT_RUN_STATUS_VALUES)[number];

export const SYSTEM_STATUS_SAFE_REASONS = [
  'NO_TRACKED_REPOSITORIES',
  'UPSTREAM_RATE_LIMITED',
  'RUN_INCOMPLETE',
  'STALE_DATA',
] as const;
export type SystemStatusSafeReasonResponseDto =
  (typeof SYSTEM_STATUS_SAFE_REASONS)[number];

export class CollectionSystemStatusResponseDto {
  constructor(
    readonly health: CollectionHealthResponseDto,
    readonly dataAsOf: string | null,
    readonly trackedRepositoryCount: number,
    readonly readyStreamCount: number,
    readonly backfillingStreamCount: number,
    readonly partialStreamCount: number,
    readonly retryPendingStreamCount: number,
    readonly oldestReadyCheckpointAt: string | null,
    readonly oldestRetryPendingAt: string | null,
    readonly lastCycleStartedAt: string | null,
    readonly lastCycleCompletedAt: string | null,
    readonly nextCycleAt: string | null,
    readonly currentRunStatus: CurrentRunStatusResponseDto,
    readonly safeReason: SystemStatusSafeReasonResponseDto | null,
  ) {}
}

export class RepositoryProvisioningSystemStatusResponseDto {
  constructor(readonly finalFailureCount: number) {}
}

export const COLLECTION_STREAM_BUCKET_VALUES = [
  'READY',
  'BACKFILLING',
  'PARTIAL',
  'RETRY_PENDING',
] as const;
export type CollectionStreamBucketResponseDto =
  (typeof COLLECTION_STREAM_BUCKET_VALUES)[number];

export const COLLECTION_STREAM_TYPE_VALUES = [
  'COMMIT',
  'PULL_REQUEST',
  'RELEASE',
  'ISSUE',
] as const;
export type CollectionStreamTypeResponseDto =
  (typeof COLLECTION_STREAM_TYPE_VALUES)[number];

export class CollectionRepositoryStreamResponseDto {
  constructor(
    readonly streamType: CollectionStreamTypeResponseDto,
    readonly bucket: CollectionStreamBucketResponseDto,
    readonly lastSuccessAt: string | null,
    readonly lastErrorCode: string | null,
    readonly lastErrorAt: string | null,
  ) {}
}

export class SystemStatusCollectionStreamsResponseDto {
  constructor(
    readonly repositoryName: string,
    readonly programName: string | null,
    readonly streams: readonly CollectionRepositoryStreamResponseDto[],
  ) {}
}

export class SystemStatusCollectionActivityResponseDto {
  constructor(
    readonly sweepFinishedAt: string,
    readonly cycleStartedAt: string | null,
    readonly scope: string,

    readonly kind: 'SWEEP' | 'REPOSITORY_LINK',
    readonly insertedCommitCount: number,
    readonly insertedPullRequestCount: number,
    readonly insertedReleaseCount: number,
    readonly insertedIssueCount: number,
    readonly attemptedRepositoryCount: number,
    readonly processedRepositoryCount: number,
    readonly failedRepositoryCount: number,
    readonly cycleCompleted: boolean,
    readonly stoppedForBudget: boolean,
  ) {}
}

export class SystemStatusExternalCollectionResponseDto {
  constructor(
    readonly trackedRepositoryCount: number,
    readonly lastSweep: SystemStatusCollectionActivityResponseDto | null,
    readonly cumulativeCommitCount: number,
    readonly cumulativePullRequestCount: number,
    readonly cumulativeReleaseCount: number,
    readonly cumulativeIssueCount: number,
  ) {}
}

export class SystemStatusResponseDto {
  constructor(
    readonly collection: CollectionSystemStatusResponseDto,
    readonly repositoryProvisioning: RepositoryProvisioningSystemStatusResponseDto,
    readonly collectionStreams: readonly SystemStatusCollectionStreamsResponseDto[],
    readonly collectionActivity: readonly SystemStatusCollectionActivityResponseDto[],
    readonly externalCollection: SystemStatusExternalCollectionResponseDto,
  ) {}
}
