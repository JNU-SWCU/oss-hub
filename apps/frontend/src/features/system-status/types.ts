export type CollectionHealth =
  'EMPTY' | 'NORMAL' | 'DELAYED' | 'PARTIAL' | 'FAILED';

export type CurrentRunStatus = 'IDLE' | 'PROCESSING';

export type SystemStatusSafeReason =
  | 'NO_TRACKED_REPOSITORIES'
  | 'UPSTREAM_RATE_LIMITED'
  | 'RUN_INCOMPLETE'
  | 'STALE_DATA';

export interface SystemStatus {
  readonly health: CollectionHealth;
  readonly dataAsOf: string | null;
  readonly trackedRepositoryCount: number;
  readonly readyStreamCount: number;
  readonly backfillingStreamCount: number;
  readonly partialStreamCount: number;
  readonly retryPendingStreamCount: number;
  readonly oldestReadyCheckpointAt: string | null;
  readonly oldestRetryPendingAt: string | null;
  readonly lastCycleStartedAt: string | null;
  readonly lastCycleCompletedAt: string | null;
  /** 다음 예정 수집 사이클 시각. 스케줄이 아직 정해지지 않았으면 null. */
  readonly nextCycleAt: string | null;
  readonly currentRunStatus: CurrentRunStatus;
  readonly safeReason: SystemStatusSafeReason | null;
}

export type CollectionStreamType = 'COMMIT' | 'PULL_REQUEST' | 'RELEASE';

/** 집계 카운트(readyStreamCount 등)와 같은 4구간. */
export type CollectionStreamBucket =
  'READY' | 'BACKFILLING' | 'PARTIAL' | 'RETRY_PENDING';

export interface CollectionStreamDetail {
  readonly streamType: CollectionStreamType;
  readonly bucket: CollectionStreamBucket;
  readonly lastSuccessAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAt: string | null;
}

export interface CollectionStreamRepository {
  readonly repositoryName: string;
  /**
   * 이 저장소가 어느 프로그램 소속으로 편입됐는지(백엔드 `Repository.programId`
   * 경유 조인, `collection-read.port.ts`의 `CollectionRepositoryStreamsDto` 참고).
   * 이 필드가 붙는 저장소는 애초에 org 저장소뿐이다 — 학생 개인(external)
   * 저장소는 이 목록에 행 자체로 나타나지 않는다. 연결이 없으면(org 저장소 중
   * 신청 승인 경로를 거치지 않고 관리자가 직접 만든 경우) `null`이며 이는
   * 정상이다 — "알 수 없음" 같은 오류 문구로 보여주지 않는다.
   */
  readonly programName: string | null;
  readonly streams: readonly CollectionStreamDetail[];
}

/**
 * 수집 sweep 한 번의 활동 요약(2단계). `scope`는 백엔드 원값을 그대로 담는다 —
 * 알려진 값(`ORG`, `EXTERNAL`)은 화면에서 한국어로 옮기고, 그 외 값은 원문을
 * monospace로 보여준다(collection-streams-table의 에러코드 fallback과 같은 원칙).
 */
export interface CollectionActivityEntry {
  readonly sweepFinishedAt: string;
  readonly cycleStartedAt: string | null;
  readonly scope: string;
  readonly insertedCommitCount: number;
  readonly insertedPullRequestCount: number;
  readonly insertedReleaseCount: number;
  readonly attemptedRepositoryCount: number;
  readonly processedRepositoryCount: number;
  readonly failedRepositoryCount: number;
  readonly cycleCompleted: boolean;
  readonly stoppedForBudget: boolean;
}

/**
 * 시스템 상태 3단계 — org sweep과 별개인 external(학생 개인 공개 GitHub 저장소)
 * 수집 현황. `lastSweep`이 `null`이면 external sweep이 아직 한 번도 끝나지 않은
 * 것이다 — sweep 자체는 매시 자동 실행되므로 이 값이 계속 `null`이면 스케줄러가
 * 아예 안 도는 것이지 대상이 없어서가 아니다(백엔드
 * `SystemStatusExternalCollectionResponseDto`와 동일한 계약).
 */
export interface ExternalCollectionStatus {
  readonly trackedRepositoryCount: number;
  readonly lastSweep: CollectionActivityEntry | null;
  readonly cumulativeCommitCount: number;
  readonly cumulativePullRequestCount: number;
  readonly cumulativeReleaseCount: number;
}

export interface SystemStatusResponse {
  readonly collection: SystemStatus;
  readonly collectionStreams: readonly CollectionStreamRepository[];
  /** 배포 window에는 구버전 백엔드가 이 필드 자체를 보내지 않을 수 있다. */
  readonly collectionActivity?: readonly CollectionActivityEntry[];
  /** collectionActivity와 같은 배포 window 문제 — 구버전 백엔드는 이 필드를 보내지 않는다. */
  readonly externalCollection?: ExternalCollectionStatus;
}

export interface SystemStatusData {
  readonly status: SystemStatus;
  readonly collectionStreams: readonly CollectionStreamRepository[];
  readonly collectionActivity: readonly CollectionActivityEntry[];
  readonly externalCollection: ExternalCollectionStatus;
}

export type SystemStatusViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'success';
      readonly status: SystemStatus;
      readonly collectionStreams: readonly CollectionStreamRepository[];
      readonly collectionActivity: readonly CollectionActivityEntry[];
      readonly externalCollection: ExternalCollectionStatus;
    };

export type TriggerNotice =
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };
