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
    readonly currentRunStatus: CurrentRunStatusResponseDto,
    readonly safeReason: SystemStatusSafeReasonResponseDto | null,
  ) {}
}

export class SystemStatusResponseDto {
  constructor(readonly collection: CollectionSystemStatusResponseDto) {}
}
