import type {
  SystemStatusResult,
  SystemStatusCollectionActivityResult,
} from '../domain/system-status.models';
export type CollectionHealthResponseDto =
  'EMPTY' | 'NORMAL' | 'DELAYED' | 'PARTIAL' | 'FAILED';

export type CurrentRunStatusResponseDto = 'IDLE' | 'PROCESSING';

export type SystemStatusSafeReasonResponseDto =
  | 'NO_TRACKED_REPOSITORIES'
  | 'UPSTREAM_RATE_LIMITED'
  | 'RUN_INCOMPLETE'
  | 'STALE_DATA';

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

export type CollectionStreamBucketResponseDto =
  'READY' | 'BACKFILLING' | 'PARTIAL' | 'RETRY_PENDING';

export type CollectionStreamTypeResponseDto =
  'COMMIT' | 'PULL_REQUEST' | 'RELEASE' | 'ISSUE';

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

export function systemStatusResponse(
  result: SystemStatusResult,
): SystemStatusResponseDto {
  const collection = result.collection;
  const external = result.externalCollection;
  return new SystemStatusResponseDto(
    new CollectionSystemStatusResponseDto(
      collection.health,
      collection.dataAsOf?.toISOString() ?? null,
      collection.trackedRepositoryCount,
      collection.readyStreamCount,
      collection.backfillingStreamCount,
      collection.partialStreamCount,
      collection.retryPendingStreamCount,
      collection.oldestReadyCheckpointAt?.toISOString() ?? null,
      collection.oldestRetryPendingAt?.toISOString() ?? null,
      collection.lastCycleStartedAt?.toISOString() ?? null,
      collection.lastCycleCompletedAt?.toISOString() ?? null,
      collection.nextCycleAt?.toISOString() ?? null,
      collection.currentRunStatus,
      collection.safeReason,
    ),
    new RepositoryProvisioningSystemStatusResponseDto(
      result.repositoryProvisioning.finalFailureCount,
    ),
    result.collectionStreams.map(
      (repository) =>
        new SystemStatusCollectionStreamsResponseDto(
          repository.repositoryName,
          repository.programName,
          repository.streams.map(
            (stream) =>
              new CollectionRepositoryStreamResponseDto(
                stream.streamType,
                stream.bucket,
                stream.lastSuccessAt?.toISOString() ?? null,
                stream.lastErrorCode,
                stream.lastErrorAt?.toISOString() ?? null,
              ),
          ),
        ),
    ),
    result.collectionActivity.map(collectionActivityResponse),
    new SystemStatusExternalCollectionResponseDto(
      external.trackedRepositoryCount,
      external.lastSweep
        ? collectionActivityResponse(external.lastSweep)
        : null,
      external.cumulativeCommitCount,
      external.cumulativePullRequestCount,
      external.cumulativeReleaseCount,
      external.cumulativeIssueCount,
    ),
  );
}

function collectionActivityResponse(
  sweep: SystemStatusCollectionActivityResult,
): SystemStatusCollectionActivityResponseDto {
  return new SystemStatusCollectionActivityResponseDto(
    sweep.sweepFinishedAt.toISOString(),
    sweep.cycleStartedAt?.toISOString() ?? null,
    sweep.scope,
    sweep.kind,
    sweep.insertedCommitCount,
    sweep.insertedPullRequestCount,
    sweep.insertedReleaseCount,
    sweep.insertedIssueCount,
    sweep.attemptedRepositoryCount,
    sweep.processedRepositoryCount,
    sweep.failedRepositoryCount,
    sweep.cycleCompleted,
    sweep.stoppedForBudget,
  );
}
