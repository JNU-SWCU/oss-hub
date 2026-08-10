/**
 * todo 12 — 이전 5개 값(NORMAL/DELAYED/FAILED 3-state)에서 증분 collection 진행 상황을
 * 반영하는 5-state로 breaking 마이그레이션한다(계획에서 명시적으로 승인된 DTO 호환성
 * 변경). EMPTY(추적 저장소 없음)·PARTIAL(일부 stream이 아직 backfill/미검증)이 새로 추가된
 * state다.
 */
export const COLLECTION_HEALTH_VALUES = [
  'EMPTY',
  'NORMAL',
  'DELAYED',
  'PARTIAL',
  'FAILED',
] as const;
export type CollectionHealthResponseDto =
  (typeof COLLECTION_HEALTH_VALUES)[number];

/**
 * todo 12 — 증분 엔진(`CollectionSyncCursor`)에는 old 엔진의 PENDING(대기열) 개념이 없다 —
 * 사이클이 진행 중(PROCESSING)이거나 아니면 IDLE이다.
 */
export const CURRENT_RUN_STATUS_VALUES = ['IDLE', 'PROCESSING'] as const;
export type CurrentRunStatusResponseDto =
  (typeof CURRENT_RUN_STATUS_VALUES)[number];

/**
 * todo 12 — old 엔진 전용 사유(`INSTALLATION_INVALID`/`PERMISSION_INVALID`/`RUN_FAILED`
 * 등, 새 증분 스냅샷에서 도출 불가)는 제거하고, 증분 스냅샷에서 직접 도출 가능한 4개로
 * 좁힌다. `STALE_DATA`만 이름을 그대로 유지한다(동일 의미).
 */
export const SYSTEM_STATUS_SAFE_REASONS = [
  'NO_TRACKED_REPOSITORIES',
  'UPSTREAM_RATE_LIMITED',
  'RUN_INCOMPLETE',
  'STALE_DATA',
] as const;
export type SystemStatusSafeReasonResponseDto =
  (typeof SYSTEM_STATUS_SAFE_REASONS)[number];

/**
 * `CollectionReadPort#getIncrementalStatusSnapshot`을 그대로 반영한 공개 응답 — repository
 * 이름·visibility·raw payload·collection lease/frontier 같은 물리 스키마는 절대 포함하지
 * 않는다(count/checkpoint 시각만). health/safeReason 해석은 `SystemStatusService.decide`
 * 책임이다.
 *
 * 2026-08 owner 결정 — "repository 이름을 절대 포함하지 않는다"는 이 집계 object 한정
 * 경계로 남는다. 저장소 단위 상세가 필요해져 그 경계를 옮긴 곳은 이 DTO가 아니라 아래
 * `SystemStatusResponseDto`의 형제 필드 `collectionStreams`다 — 집계는 여전히 집계로만
 * 읽힌다. `nextCycleAt`은 새 필드지만 cron 표현식에서 계산한 시각일 뿐 물리 스키마가
 * 아니라 이 경계와 무관하다.
 */
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

/**
 * 2026-08 owner 결정 — ADMIN 전용 system-status 화면에 한해 저장소 이름과 stream별 상세를
 * 노출한다. `CollectionSystemStatusResponseDto`(조직 전체 집계)가 지켜온 "repository 이름을
 * 담지 않는다" 경계를 이 필드가 의도적으로 넘는다 — 무엇이 언제 수집됐는지 저장소 단위로
 * 들여다볼 관측성이 필요해졌기 때문이다(`collection-read.port.ts`의 boundary 코멘트,
 * `apps/backend/src/github/AGENTS.md` 참고). ADMIN 가드 밖으로는 절대 재사용하지 않는다.
 */
export class SystemStatusCollectionStreamsResponseDto {
  constructor(
    readonly repositoryName: string,
    readonly streams: readonly CollectionRepositoryStreamResponseDto[],
  ) {}
}

/**
 * 시스템 상태 관측성 2단계 — sweep 1회 종료 시점의 활동 이력(`CollectionSweepHistory`)을
 * `sweepFinishedAt` 내림차순, 최대 20건으로 노출한다. `collectionStreams`와 달리 이
 * 필드는 repository 이름을 담지 않는다 — 집계 전용이다(`collection-read.port.ts`의
 * `CollectionSweepActivityDto` 참고).
 */
export class SystemStatusCollectionActivityResponseDto {
  constructor(
    readonly sweepFinishedAt: string,
    readonly cycleStartedAt: string | null,
    readonly scope: string,
    readonly insertedCommitCount: number,
    readonly insertedPullRequestCount: number,
    readonly insertedReleaseCount: number,
    readonly attemptedRepositoryCount: number,
    readonly processedRepositoryCount: number,
    readonly failedRepositoryCount: number,
    readonly cycleCompleted: boolean,
    readonly stoppedForBudget: boolean,
  ) {}
}

/**
 * 시스템 상태 3단계 — org sweep과 별개인 external(학생 개인 공개 저장소) 수집
 * 현황. `lastSweep`이 `null`이면 external sweep이 아직 한 번도 끝나지 않은
 * 것이다(collection-read.port.ts의 `CollectionExternalCollectionStatusDto`
 * 참고) — sweep 자체는 매시 자동 실행되므로 이 값이 계속 `null`이면 스케줄러가
 * 아예 안 도는 것이지 대상이 없어서가 아니다.
 */
export class SystemStatusExternalCollectionResponseDto {
  constructor(
    readonly trackedRepositoryCount: number,
    readonly lastSweep: SystemStatusCollectionActivityResponseDto | null,
    readonly cumulativeCommitCount: number,
    readonly cumulativePullRequestCount: number,
    readonly cumulativeReleaseCount: number,
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
