import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import {
  COLLECTION_READ_PORT,
  type CollectionIncrementalStatusSnapshotDto,
  type CollectionReadPort,
  type CollectionRepositoryStreamsDto,
} from '../github/collection-read.port';
import { SystemStatusRepository } from './system-status.repository';
import {
  CollectionRepositoryStreamResponseDto,
  CollectionSystemStatusResponseDto,
  RepositoryProvisioningSystemStatusResponseDto,
  SystemStatusCollectionStreamsResponseDto,
  SystemStatusResponseDto,
  type CollectionHealthResponseDto,
  type CurrentRunStatusResponseDto,
  type SystemStatusSafeReasonResponseDto,
} from './dto/system-status-response.dto';
const STALE_AFTER_MS = 90 * 60 * 1000;
export const SYSTEM_STATUS_CLOCK = Symbol('SYSTEM_STATUS_CLOCK');
export type SystemStatusClock = () => Date;

interface StatusDecision {
  health: CollectionHealthResponseDto;
  reason: SystemStatusSafeReasonResponseDto | null;
}

/**
 * todo 12 — `getStatusSnapshot()`(old canonical 엔진) 대신 `getIncrementalStatusSnapshot()`
 * (ADR-006 증분 엔진, `CollectionRepositoryStream`/`CollectionSyncCursor` 집계)을 유일한
 * source로 소비한다. health 해석(empty/normal/delayed/partial/failed)은 이 서비스의
 * 책임으로 남는다 — port는 count/checkpoint 시각만 넘긴다.
 */
@Injectable()
export class SystemStatusService {
  constructor(
    private readonly repository: SystemStatusRepository,
    @Inject(COLLECTION_READ_PORT)
    private readonly collection: CollectionReadPort,
    @Inject(SYSTEM_STATUS_CLOCK) private readonly clock: SystemStatusClock,
  ) {}

  async getStatus(actorGithubId: bigint): Promise<SystemStatusResponseDto> {
    const actor = await this.repository.findActor(actorGithubId);
    if (
      actor?.role !== Role.ADMIN ||
      actor.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new ForbiddenException('Active administrator access is required');
    }

    const [snapshot, finalFailureCount, streams, nextCycleAt] =
      await Promise.all([
        this.collection.getIncrementalStatusSnapshot(),
        this.repository.countFinalProvisionFailures(),
        this.collection.getIncrementalStatusStreams(),
        this.collection.getNextScheduledCycleAt(this.clock()),
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
    );
  }

  private toStreamsResponse(
    repository: CollectionRepositoryStreamsDto,
  ): SystemStatusCollectionStreamsResponseDto {
    return new SystemStatusCollectionStreamsResponseDto(
      repository.repositoryName,
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

  /**
   * 우선순위: EMPTY(추적 저장소 없음) → FAILED(재시도 대기 중인 stream 존재 — 실제 오류
   * 신호) → PARTIAL(일부 stream이 아직 backfill/미검증) → DELAYED(전부 READY지만 마지막
   * checkpoint가 오래됨) → NORMAL.
   */
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
