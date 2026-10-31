import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import {
  SystemStatusRepository,
  type CollectionIncrementalStatusSnapshotDto,
} from './system-status.repository';

type CollectionHealthResult =
  'EMPTY' | 'NORMAL' | 'DELAYED' | 'PARTIAL' | 'FAILED';

export type CurrentRunStatusResult = 'IDLE' | 'PROCESSING';

type SystemStatusSafeReasonResult =
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

const RECENT_SWEEP_ACTIVITY_LIMIT = 20;
const STALE_AFTER_MS = 90 * 60 * 1000;
export const SYSTEM_STATUS_CLOCK = Symbol('SYSTEM_STATUS_CLOCK');
export type SystemStatusClock = () => Date;

interface StatusDecision {
  health: CollectionHealthResult;
  reason: SystemStatusSafeReasonResult | null;
}

@Injectable()
export class SystemStatusService {
  constructor(
    private readonly repository: SystemStatusRepository,
    @Inject(SYSTEM_STATUS_CLOCK) private readonly clock: SystemStatusClock,
  ) {}

  async getStatus(actorGithubId: bigint): Promise<SystemStatusResult> {
    const actor = await this.repository.findActor(actorGithubId);
    if (
      actor?.hasAdminAccess !== true ||
      actor.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new ForbiddenException('Active administrator access is required');
    }

    const nextCycleAt = CollectionScheduleService.nextScheduledCollectionAt(
      this.clock(),
    );
    const [snapshot, finalFailureCount, streams, activity, externalStatus] =
      await Promise.all([
        this.repository.getIncrementalStatusSnapshot(),
        this.repository.countFinalProvisionFailures(),
        this.repository.getIncrementalStatusStreams(),
        this.repository.getRecentSweepActivity(RECENT_SWEEP_ACTIVITY_LIMIT),
        this.repository.getExternalCollectionStatus(),
      ]);
    const decision = this.decide(snapshot);
    return {
      collection: {
        health: decision.health,
        dataAsOf: snapshot.latestCheckpointAt,
        trackedRepositoryCount: snapshot.trackedRepositoryCount,
        readyStreamCount: snapshot.readyStreamCount,
        backfillingStreamCount: snapshot.backfillingStreamCount,
        partialStreamCount: snapshot.partialStreamCount,
        retryPendingStreamCount: snapshot.retryPendingStreamCount,
        oldestReadyCheckpointAt: snapshot.oldestReadyCheckpointAt,
        oldestRetryPendingAt: snapshot.oldestRetryPendingAt,
        lastCycleStartedAt: snapshot.lastCycleStartedAt,
        lastCycleCompletedAt: snapshot.lastCycleCompletedAt,
        nextCycleAt,
        currentRunStatus: this.currentRunStatus(snapshot),
        safeReason: decision.reason,
      },
      repositoryProvisioning: { finalFailureCount },
      collectionStreams: streams,
      collectionActivity: activity,
      externalCollection: externalStatus,
    };
  }

  private decide(
    snapshot: CollectionIncrementalStatusSnapshotDto,
  ): StatusDecision {
    if (snapshot.trackedRepositoryCount === 0) {
      return { health: 'EMPTY', reason: 'NO_TRACKED_REPOSITORIES' };
    }
    if (snapshot.retryPendingStreamCount > 0) {
      return { health: 'FAILED', reason: 'UPSTREAM_RATE_LIMITED' };
    }
    if (
      snapshot.partialStreamCount > 0 ||
      snapshot.backfillingStreamCount > 0
    ) {
      return { health: 'PARTIAL', reason: 'RUN_INCOMPLETE' };
    }
    if (
      snapshot.latestCheckpointAt &&
      this.clock().getTime() - snapshot.latestCheckpointAt.getTime() >
        STALE_AFTER_MS
    ) {
      return { health: 'DELAYED', reason: 'STALE_DATA' };
    }
    return { health: 'NORMAL', reason: null };
  }

  private currentRunStatus(
    snapshot: CollectionIncrementalStatusSnapshotDto,
  ): CurrentRunStatusResult {
    const started = snapshot.lastCycleStartedAt;
    const completed = snapshot.lastCycleCompletedAt;
    const isProcessing =
      started !== null && (completed === null || completed < started);
    return isProcessing ? 'PROCESSING' : 'IDLE';
  }
}
