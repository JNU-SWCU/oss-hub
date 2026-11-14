import type { SystemStatusResult } from '../system-status.service';

export type CollectionHealthResponseDto = 'EMPTY' | 'NORMAL' | 'DELAYED';

export type CurrentRunStatusResponseDto = 'IDLE' | 'PROCESSING';

export type SystemStatusSafeReasonResponseDto =
  'NO_TRACKED_REPOSITORIES' | 'STALE_DATA';

export class CollectionSystemStatusResponseDto {
  declare readonly health: CollectionHealthResponseDto;
  declare readonly trackedRepositoryCount: number;
  declare readonly staleRepositoryCount: number;
  declare readonly lastSuccessAt: string | null;
  declare readonly nextCycleAt: string | null;
  declare readonly currentRunStatus: CurrentRunStatusResponseDto;
  declare readonly safeReason: SystemStatusSafeReasonResponseDto | null;

  static from(
    collection: SystemStatusResult['collection'],
  ): CollectionSystemStatusResponseDto {
    return {
      health: collection.health,
      trackedRepositoryCount: collection.trackedRepositoryCount,
      staleRepositoryCount: collection.staleRepositoryCount,
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

export class SystemStatusCollectionRepositoryResponseDto {
  declare readonly repositoryName: string;
  declare readonly programName: string | null;
  declare readonly lastSuccessAt: string | null;
  declare readonly stale: boolean;

  static from(
    repository: SystemStatusResult['collectionRepositories'][number],
  ): SystemStatusCollectionRepositoryResponseDto {
    return {
      repositoryName: repository.repositoryName,
      programName: repository.programName,
      lastSuccessAt: repository.lastSuccessAt?.toISOString() ?? null,
      stale: repository.stale,
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
  declare readonly collectionRepositories: readonly SystemStatusCollectionRepositoryResponseDto[];
  declare readonly externalCollection: SystemStatusExternalCollectionResponseDto;

  static from(result: SystemStatusResult): SystemStatusResponseDto {
    return {
      collection: CollectionSystemStatusResponseDto.from(result.collection),
      repositoryProvisioning:
        RepositoryProvisioningSystemStatusResponseDto.from(
          result.repositoryProvisioning,
        ),
      collectionRepositories: result.collectionRepositories.map((repository) =>
        SystemStatusCollectionRepositoryResponseDto.from(repository),
      ),
      externalCollection: SystemStatusExternalCollectionResponseDto.from(
        result.externalCollection,
      ),
    };
  }
}
