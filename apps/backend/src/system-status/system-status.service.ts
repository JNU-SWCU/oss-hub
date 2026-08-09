import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { CronTime } from 'cron';
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
/** collection cron 표현식 — `getIncrementalStatusStreams`가 아니라 별도 DI 토큰인 이유는
 * 테스트가 `SYSTEM_STATUS_CLOCK`처럼 임의의 표현식(또는 잘못된 표현식)을 주입해
 * `nextCycleAt` 파생 로직을 실제 cron job 등록·process.env 없이 검증할 수 있어야 하기
 * 때문이다. 운영 배선(`system-status.module.ts`)은 실제로 등록된 표현식
 * (`collection-scheduler.service.ts`의 `COLLECTION_CRON_EXPRESSION`)을 그대로 넘긴다. */
export const SYSTEM_STATUS_COLLECTION_CRON_EXPRESSION = Symbol(
  'SYSTEM_STATUS_COLLECTION_CRON_EXPRESSION',
);

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
    @Inject(SYSTEM_STATUS_COLLECTION_CRON_EXPRESSION)
    private readonly collectionCronExpression: string,
  ) {}

  async getStatus(actorGithubId: bigint): Promise<SystemStatusResponseDto> {
    const actor = await this.repository.findActor(actorGithubId);
    if (
      actor?.role !== Role.ADMIN ||
      actor.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new ForbiddenException('Active administrator access is required');
    }

    const [snapshot, finalFailureCount, streams] = await Promise.all([
      this.collection.getIncrementalStatusSnapshot(),
      this.repository.countFinalProvisionFailures(),
      this.collection.getIncrementalStatusStreams(),
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
        this.nextCycleAt(),
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
   * 다음 사이클 시작 예정 시각 — 배선된 cron 표현식(`collectionCronExpression`)을
   * `getStatus` 호출 시점(`this.clock()`)부터 Asia/Seoul 기준으로 평가한다. 표현식이
   * 유효하지 않으면(운영 실수로 잘못된 값이 들어간 경우) 계산을 포기하고 `null`을
   * 반환한다 — 이 계산 실패가 나머지 system-status 응답을 막아서는 안 된다.
   */
  private nextCycleAt(): string | null {
    try {
      const cronTime = new CronTime(
        this.collectionCronExpression,
        'Asia/Seoul',
      );
      return cronTime.getNextDateFrom(this.clock()).toJSDate().toISOString();
    } catch {
      return null;
    }
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
