import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import {
  SystemStatusRepository,
  type CollectionExternalCollectionStatusDto,
  type CollectionIncrementalStatusSnapshotDto,
  type CollectionRepositoryStreamsDto,
  type CollectionSweepActivityDto,
} from '../repository/system-status.repository';
import {
  CollectionRepositoryStreamResponseDto,
  CollectionSystemStatusResponseDto,
  RepositoryProvisioningSystemStatusResponseDto,
  SystemStatusCollectionActivityResponseDto,
  SystemStatusCollectionStreamsResponseDto,
  SystemStatusExternalCollectionResponseDto,
  SystemStatusResponseDto,
  type CollectionHealthResponseDto,
  type CurrentRunStatusResponseDto,
  type SystemStatusSafeReasonResponseDto,
} from '../dto/system-status-response.dto';

const RECENT_SWEEP_ACTIVITY_LIMIT = 20;
const STALE_AFTER_MS = 90 * 60 * 1000;
export const SYSTEM_STATUS_CLOCK = Symbol('SYSTEM_STATUS_CLOCK');
export type SystemStatusClock = () => Date;

interface StatusDecision {
  health: CollectionHealthResponseDto;
  reason: SystemStatusSafeReasonResponseDto | null;
}

@Injectable()
export class SystemStatusService {
  constructor(
    private readonly repository: SystemStatusRepository,
    @Inject(SYSTEM_STATUS_CLOCK) private readonly clock: SystemStatusClock,
  ) {}

  async getStatus(actorGithubId: bigint): Promise<SystemStatusResponseDto> {
    const actor = await this.repository.findActor(actorGithubId);
    if (
      actor?.hasAdminAccess !== true ||
      actor.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new ForbiddenException('Active administrator access is required');
    }

    const nextCycleAt = this.repository.findNextCycleAt(this.clock());
    const [snapshot, finalFailureCount, streams, activity, externalStatus] =
      await Promise.all([
        this.repository.getIncrementalStatusSnapshot(),
        this.repository.countFinalProvisionFailures(),
        this.repository.getIncrementalStatusStreams(),
        this.repository.getRecentSweepActivity(RECENT_SWEEP_ACTIVITY_LIMIT),
        this.repository.getExternalCollectionStatus(),
      ]);
    const decision = this.decide(snapshot);
    return new SystemStatusResponseDto(
      new CollectionSystemStatusResponseDto(
        decision.health,
        snapshot.latestCheckpointAt?.toISOString() ?? null,
        snapshot.trackedRepositoryCount,
        snapshot.readyStreamCount,
        snapshot.backfillingStreamCount,
        snapshot.partialStreamCount,
        snapshot.retryPendingStreamCount,
        snapshot.oldestReadyCheckpointAt?.toISOString() ?? null,
        snapshot.oldestRetryPendingAt?.toISOString() ?? null,
        snapshot.lastCycleStartedAt?.toISOString() ?? null,
        snapshot.lastCycleCompletedAt?.toISOString() ?? null,
        nextCycleAt?.toISOString() ?? null,
        this.currentRunStatus(snapshot),
        decision.reason,
      ),
      new RepositoryProvisioningSystemStatusResponseDto(finalFailureCount),
      streams.map((repository) => this.toStreamsResponse(repository)),
      activity.map((sweep) => this.toActivityResponse(sweep)),
      this.toExternalCollectionResponse(externalStatus),
    );
  }

  private toExternalCollectionResponse(
    status: CollectionExternalCollectionStatusDto,
  ): SystemStatusExternalCollectionResponseDto {
    return new SystemStatusExternalCollectionResponseDto(
      status.trackedRepositoryCount,
      status.lastSweep ? this.toActivityResponse(status.lastSweep) : null,
      status.cumulativeCommitCount,
      status.cumulativePullRequestCount,
      status.cumulativeReleaseCount,
      status.cumulativeIssueCount,
    );
  }

  private toStreamsResponse(
    repository: CollectionRepositoryStreamsDto,
  ): SystemStatusCollectionStreamsResponseDto {
    return new SystemStatusCollectionStreamsResponseDto(
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
    );
  }

  private toActivityResponse(
    sweep: CollectionSweepActivityDto,
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
  ): CurrentRunStatusResponseDto {
    const started = snapshot.lastCycleStartedAt;
    const completed = snapshot.lastCycleCompletedAt;
    const isProcessing =
      started !== null && (completed === null || completed < started);
    return isProcessing ? 'PROCESSING' : 'IDLE';
  }
}
