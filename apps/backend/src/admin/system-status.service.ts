import { Inject, Injectable } from '@nestjs/common';
import { COLLECTION_STALE_AFTER_MS } from '../github/collection-app.config';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import { SystemStatusRepository } from './system-status.repository';

type CollectionHealthResult = 'EMPTY' | 'NORMAL' | 'DELAYED';

type CurrentRunStatusResult = 'IDLE' | 'PROCESSING';

type SystemStatusSafeReasonResult = 'NO_TRACKED_REPOSITORIES' | 'STALE_DATA';

interface CollectionSystemStatusResult {
  readonly health: CollectionHealthResult;
  readonly trackedRepositoryCount: number;
  readonly staleRepositoryCount: number;
  readonly lastSuccessAt: Date | null;
  readonly nextCycleAt: Date | null;
  readonly currentRunStatus: CurrentRunStatusResult;
  readonly safeReason: SystemStatusSafeReasonResult | null;
}

interface RepositoryProvisioningSystemStatusResult {
  readonly finalFailureCount: number;
}

interface SystemStatusCollectionRepositoryResult {
  readonly repositoryName: string;
  readonly programName: string | null;
  readonly lastSuccessAt: Date | null;
  readonly stale: boolean;
}

interface SystemStatusExternalCollectionResult {
  readonly trackedRepositoryCount: number;
  readonly lastSuccessAt: Date | null;
}

export interface SystemStatusResult {
  readonly collection: CollectionSystemStatusResult;
  readonly repositoryProvisioning: RepositoryProvisioningSystemStatusResult;
  readonly collectionRepositories: readonly SystemStatusCollectionRepositoryResult[];
  readonly externalCollection: SystemStatusExternalCollectionResult;
}

export const SYSTEM_STATUS_CLOCK = Symbol('SYSTEM_STATUS_CLOCK');
export type SystemStatusClock = () => Date;

@Injectable()
export class SystemStatusService {
  constructor(
    private readonly repository: SystemStatusRepository,
    @Inject(SYSTEM_STATUS_CLOCK) private readonly clock: SystemStatusClock,
    private readonly collectionSchedule: CollectionScheduleService,
  ) {}

  async getStatus(): Promise<SystemStatusResult> {
    const now = this.clock();
    const nextCycleAt = this.collectionSchedule.nextScheduledCollectionAt(now);
    const [repositories, running, finalFailureCount, externalCollection] =
      await Promise.all([
        this.repository.getCollectionRepositories(),
        this.repository.hasActiveCollectionRun(now),
        this.repository.countFinalProvisionFailures(),
        this.repository.getExternalCollectionStatus(),
      ]);
    const collectionRepositories = repositories.map((repository) => ({
      ...repository,
      stale:
        repository.lastSuccessAt !== null &&
        now.getTime() - repository.lastSuccessAt.getTime() >
          COLLECTION_STALE_AFTER_MS,
    }));
    const staleRepositoryCount = collectionRepositories.filter(
      (repository) => repository.stale,
    ).length;
    const lastSuccessAt = collectionRepositories.reduce<Date | null>(
      (latest, repository) =>
        repository.lastSuccessAt !== null &&
        (latest === null || latest < repository.lastSuccessAt)
          ? repository.lastSuccessAt
          : latest,
      null,
    );
    const health: CollectionHealthResult =
      collectionRepositories.length === 0
        ? 'EMPTY'
        : staleRepositoryCount > 0
          ? 'DELAYED'
          : 'NORMAL';
    return {
      collection: {
        health,
        trackedRepositoryCount: collectionRepositories.length,
        staleRepositoryCount,
        lastSuccessAt,
        nextCycleAt,
        currentRunStatus: running ? 'PROCESSING' : 'IDLE',
        safeReason:
          health === 'EMPTY'
            ? 'NO_TRACKED_REPOSITORIES'
            : health === 'DELAYED'
              ? 'STALE_DATA'
              : null,
      },
      repositoryProvisioning: { finalFailureCount },
      collectionRepositories,
      externalCollection,
    };
  }
}
