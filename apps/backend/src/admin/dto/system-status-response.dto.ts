import type { SystemStatusResult } from '../system-status.service';

export type CollectionHealthResponseDto =
  'EMPTY' | 'NORMAL' | 'DELAYED' | 'PARTIAL' | 'FAILED';

export type CurrentRunStatusResponseDto = 'IDLE' | 'PROCESSING';

export type SystemStatusSafeReasonResponseDto =
  | 'NO_TRACKED_REPOSITORIES'
  | 'UPSTREAM_RATE_LIMITED'
  | 'RUN_INCOMPLETE'
  | 'STALE_DATA';

export class CollectionSystemStatusResponseDto {
  declare readonly health: CollectionHealthResponseDto;
  declare readonly dataAsOf: string | null;
  declare readonly trackedRepositoryCount: number;
  declare readonly readyStreamCount: number;
  declare readonly backfillingStreamCount: number;
  declare readonly partialStreamCount: number;
  declare readonly retryPendingStreamCount: number;
  declare readonly oldestReadyCheckpointAt: string | null;
  declare readonly oldestRetryPendingAt: string | null;
  declare readonly lastCycleStartedAt: string | null;
  declare readonly lastCycleCompletedAt: string | null;
  declare readonly lastSuccessAt: string | null;
  declare readonly nextCycleAt: string | null;
  declare readonly currentRunStatus: CurrentRunStatusResponseDto;
  declare readonly safeReason: SystemStatusSafeReasonResponseDto | null;

  static from(
    collection: SystemStatusResult['collection'],
  ): CollectionSystemStatusResponseDto {
    return {
      health: collection.health,
      dataAsOf: collection.dataAsOf?.toISOString() ?? null,
      trackedRepositoryCount: collection.trackedRepositoryCount,
      readyStreamCount: collection.readyStreamCount,
      backfillingStreamCount: collection.backfillingStreamCount,
      partialStreamCount: collection.partialStreamCount,
      retryPendingStreamCount: collection.retryPendingStreamCount,
      oldestReadyCheckpointAt:
        collection.oldestReadyCheckpointAt?.toISOString() ?? null,
      oldestRetryPendingAt:
        collection.oldestRetryPendingAt?.toISOString() ?? null,
      lastCycleStartedAt: collection.lastCycleStartedAt?.toISOString() ?? null,
      lastCycleCompletedAt:
        collection.lastCycleCompletedAt?.toISOString() ?? null,
      lastSuccessAt: collection.lastSuccessAt?.toISOString() ?? null,
      nextCycleAt: collection.nextCycleAt?.toISOString() ?? null,
      currentRunStatus: collection.currentRunStatus,
      safeReason: collection.safeReason,
    };
  }
}

export class RepositoryProvisioningSystemStatusResponseDto {
  declare readonly finalFailureCount: number;

  static from(
    provisioning: SystemStatusResult['repositoryProvisioning'],
  ): RepositoryProvisioningSystemStatusResponseDto {
    return { finalFailureCount: provisioning.finalFailureCount };
  }
}

export type CollectionStreamBucketResponseDto =
  'READY' | 'BACKFILLING' | 'PARTIAL' | 'RETRY_PENDING';

export type CollectionStreamTypeResponseDto =
  'COMMIT' | 'PULL_REQUEST' | 'RELEASE' | 'ISSUE';

export class CollectionRepositoryStreamResponseDto {
  declare readonly streamType: CollectionStreamTypeResponseDto;
  declare readonly bucket: CollectionStreamBucketResponseDto;
  declare readonly lastSuccessAt: string | null;
  declare readonly lastErrorCode: string | null;
  declare readonly lastErrorAt: string | null;

  static from(
    stream: SystemStatusResult['collectionStreams'][number]['streams'][number],
  ): CollectionRepositoryStreamResponseDto {
    return {
      streamType: stream.streamType,
      bucket: stream.bucket,
      lastSuccessAt: stream.lastSuccessAt?.toISOString() ?? null,
      lastErrorCode: stream.lastErrorCode,
      lastErrorAt: stream.lastErrorAt?.toISOString() ?? null,
    };
  }
}

export class SystemStatusCollectionStreamsResponseDto {
  declare readonly repositoryName: string;
  declare readonly programName: string | null;
  declare readonly streams: readonly CollectionRepositoryStreamResponseDto[];

  static from(
    repository: SystemStatusResult['collectionStreams'][number],
  ): SystemStatusCollectionStreamsResponseDto {
    return {
      repositoryName: repository.repositoryName,
      programName: repository.programName,
      streams: repository.streams.map((stream) =>
        CollectionRepositoryStreamResponseDto.from(stream),
      ),
    };
  }
}

export class SystemStatusExternalCollectionResponseDto {
  declare readonly trackedRepositoryCount: number;
  declare readonly lastSuccessAt: string | null;

  static from(
    external: SystemStatusResult['externalCollection'],
  ): SystemStatusExternalCollectionResponseDto {
    return {
      trackedRepositoryCount: external.trackedRepositoryCount,
      lastSuccessAt: external.lastSuccessAt?.toISOString() ?? null,
    };
  }
}

export class SystemStatusResponseDto {
  declare readonly collection: CollectionSystemStatusResponseDto;
  declare readonly repositoryProvisioning: RepositoryProvisioningSystemStatusResponseDto;
  declare readonly collectionStreams: readonly SystemStatusCollectionStreamsResponseDto[];
  declare readonly externalCollection: SystemStatusExternalCollectionResponseDto;

  static from(result: SystemStatusResult): SystemStatusResponseDto {
    return {
      collection: CollectionSystemStatusResponseDto.from(result.collection),
      repositoryProvisioning:
        RepositoryProvisioningSystemStatusResponseDto.from(
          result.repositoryProvisioning,
        ),
      collectionStreams: result.collectionStreams.map((repository) =>
        SystemStatusCollectionStreamsResponseDto.from(repository),
      ),
      externalCollection: SystemStatusExternalCollectionResponseDto.from(
        result.externalCollection,
      ),
    };
  }
}
