import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { nextScheduledCollectionAt } from '../github/collection-schedule.service';
import {
  SystemStatusRepository,
  type CollectionIncrementalStatusSnapshotDto,
} from './system-status.repository';
import type {
  SystemStatusResult,
  CollectionHealthResult,
  CurrentRunStatusResult,
  SystemStatusSafeReasonResult,
} from './system-status.types';

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

    const nextCycleAt = nextScheduledCollectionAt(this.clock());
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
