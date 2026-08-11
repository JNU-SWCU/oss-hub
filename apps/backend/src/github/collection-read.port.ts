import type {
  CollectionRepositoryPresence,
  CollectionRepositoryVisibility,
  CollectionStreamType,
} from './collection-incremental.types';
import type { PrismaService } from '../prisma/prisma.service';
import { PublicRankingRepository } from './repository/public-ranking.repository';
import { CollectionCanonicalRepository } from './repository/collection-canonical.repository';
import { CollectionReadService } from './service/collection-read.service';

export const COLLECTION_READ_PORT = Symbol('COLLECTION_READ_PORT');

export const COLLECTION_RUN_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'INCOMPLETE',
  'RATE_LIMITED',
  'FAILED',
] as const;

export type CollectionRunStatusDto = (typeof COLLECTION_RUN_STATUSES)[number];

export type CollectionRepositoryActivityQueryDto = {
  readonly repositoryIds: readonly bigint[];
  readonly authorGithubId?: bigint;
};

export type CollectionRepositoryActivityDto = {
  readonly repositoryId: bigint;
  readonly dataAsOf: Date;
  readonly commitDates: readonly Date[];
  readonly pullRequestDates: readonly Date[];
  readonly releaseDates: readonly Date[];
};

export type CollectionRankingActivityQueryDto = {
  readonly currentYear?: number;
};

export type CollectionRankingActivityDto = {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
};

export type CollectionStatusSnapshotDto = {
  readonly installationValid: boolean;
  readonly permissionsValid: boolean;
  readonly runStatus: CollectionRunStatusDto | null;
  readonly lastCompleteSuccessAt: Date | null;
  readonly dataAsOf: Date | null;
};

/**
 * todo 11 — `Contribution`(ADR-010 §4)을 읽는 배치 질의.
 * `repositoryIds`는 기존 `CollectionRepositoryActivityQueryDto`와 동일하게 GitHub 저장소
 * ID(`githubRepositoryId`)다. `year`를 생략하면 Asia/Seoul 기준 현재 연도로 조회한다 —
 * 그 해 fact가 아직 하나도 없어도(1/1 rollover) 신규 fact write 없이 0값 결과를 반환한다.
 */
export type CollectionRepositoryMetricsQueryDto = {
  readonly repositoryIds: readonly bigint[];
  readonly year?: number;
};

/**
 * `visibility`/`presence`/`visibilityObservedAt`은 todo 15의 공개 eligibility fence가 그대로
 * 재사용할 "visibility DTO"다 — complete inventory 관찰에서만 갱신되는 저장소 신호일 뿐,
 * lease/frontier/ETag/run 같은 raw 수집 control·watermark 메타데이터는 포함하지 않는다.
 * 이 DTO는 이 포트를 호출하는 내부 서비스에는 private/public 저장소 모두 그대로 보이며
 * (private facts internally readable), public 소비자에게 안전한 형태로 값을 넘길지는
 * 호출자(추후 todo 15/19)의 책임이다.
 */
export type CollectionRepositoryMetricsDto = {
  readonly repositoryId: bigint;
  readonly year: number;
  readonly dataAsOf: Date;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly visibility: CollectionRepositoryVisibility;
  readonly presence: CollectionRepositoryPresence;
  readonly visibilityObservedAt: Date | null;
};

export type CollectionContributorMetricsQueryDto = {
  readonly repositoryIds: readonly bigint[];
  readonly year?: number;
};

export type CollectionContributorMetricsDto = {
  readonly repositoryId: bigint;
  readonly githubUserId: bigint;
  readonly githubLogin: string;
  readonly year: number;
  readonly dataAsOf: Date;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
};

/**
 * todo 16 — `getRepositoryMetrics`(연도 한정)와 달리 `Contribution`의
 * 모든 연도를 합산한 lifetime 누적이다. 공개 프로젝트 상세/프로필 라우트가 페이지당 상수
 * 개수의 질의로 지표를 배치 조회할 때 쓴다 — repositoryIds 배열 크기와 무관하게 쿼리 1개다.
 */
export type CollectionRepositoryCumulativeMetricsQueryDto = {
  readonly repositoryIds: readonly bigint[];
};

export type CollectionRepositoryCumulativeMetricsDto = {
  readonly repositoryId: bigint;
  readonly dataAsOf: Date;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  /**
   * #893 — `lastCompleteInventoryObservedAt`이 있는지(즉 첫 inventory sweep이 실제로 끝났는지)를
   * 나타내는 파생 boolean. presence: PRESENT는 provisioning 시점부터 참이라(#617 단계 D) 그
   * 자체로는 "실제 수집이 끝났는지"를 증명하지 못한다 — 원시 시각이나 presence/nextRunAt 같은
   * collection-control 필드는 노출하지 않고 이 필드 하나로만 그 구분을 공개 표면까지 전달한다.
   */
  readonly hasCollectedData: boolean;
};

/**
 * todo 16 — `getContributorMetrics`(연도 한정)와 달리 `Contribution`의
 * 모든 연도를 저장소·기여자별로 합산한 lifetime 누적이다. 공개 프로젝트 상세 라우트의 기여자
 * 목록에 쓰며, githubLogin만 노출한다(platform User join 없음, raw GitHub payload 없음).
 */
export type CollectionContributorCumulativeMetricsQueryDto = {
  readonly repositoryIds: readonly bigint[];
};

export type CollectionContributorCumulativeMetricsDto = {
  readonly repositoryId: bigint;
  readonly githubUserId: bigint;
  readonly githubLogin: string;
  readonly dataAsOf: Date;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
};

export type CollectionPublicRankingMetricsQueryDto = {
  readonly currentYear?: number;
};

export type CollectionPublicRankingMetricsDto = {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
};

/**
 * todo 12 — system-status가 관리자에게 보여줄 조직 전체 증분 collection 진행 상황 스냅샷
 * (ADR-006 `CollectionRepositoryStream`/`CollectionSyncCursor` 집계). repository 이름·
 * visibility 같은 물리 실체는 절대 포함하지 않고 stream 상태 count·checkpoint 시각만
 * 넘긴다 — health(empty/normal/delayed/partial/failed) 해석은 이 포트가 아니라
 * system-status 모듈의 책임으로 남긴다.
 *
 * `readyStreamCount`/`backfillingStreamCount`/`partialStreamCount`는 서로 배타적이며 합은
 * 항상 `trackedRepositoryCount * 3`(commit/PR/release)이다 — 아직 stream row 자체가
 * 생성되지 않은 저장소(신규 등록 직후)도 `partialStreamCount`에 포함한다.
 *
 * 2026-08 owner 결정 — 위 "repository 이름을 절대 포함하지 않는다"는 이 스냅샷(조직 전체
 * 집계) 한정 경계였다. ADMIN 전용 system-status 화면에 한해, 무엇이 언제 수집됐는지
 * 개별 저장소 단위로 들여다볼 수 있어야 한다는 관측성 요구가 이 경계와 부딪혀 owner가
 * 경계를 옮기기로 했다 — `getIncrementalStatusStreams`(아래)가 그 새 경계다. 이 스냅샷
 * 메서드 자체는 여전히 repository 이름을 포함하지 않는다(집계는 집계로 남는다); 이름
 * 노출이 필요한 상세 조회만 별도 메서드로 분리했다.
 */
export type CollectionIncrementalStatusSnapshotDto = {
  readonly trackedRepositoryCount: number;
  readonly readyStreamCount: number;
  readonly backfillingStreamCount: number;
  readonly partialStreamCount: number;
  readonly retryPendingStreamCount: number;
  readonly oldestReadyCheckpointAt: Date | null;
  readonly latestCheckpointAt: Date | null;
  readonly oldestRetryPendingAt: Date | null;
  readonly lastCycleStartedAt: Date | null;
  readonly lastCycleCompletedAt: Date | null;

  /**
   * 큐 건강 (ADR-010 §6·§10).
   *
   * 이번 사고는 "멈췄는데 아무도 몰랐다"였다. 스트림 상태만 보면 저장소 하나가
   * 계속 실패하며 큐를 붙잡고 있어도 전체 수치는 정상으로 보인다.
   * 아래 셋이 그 상황을 드러낸다.
   */
  /** 지금 수집 차례가 지난 저장소 수. 계속 늘면 스윕이 못 따라잡고 있다. */
  readonly dueRepositoryCount: number;
  /** 연속 실패 중인 저장소 수. 저장소 이름은 노출하지 않는다. */
  readonly failingRepositoryCount: number;
  /** 마지막으로 어떤 저장소든 수집에 성공한 시각. 이게 멈추면 전체가 멈춘 것이다. */
  readonly lastRepositorySuccessAt: Date | null;
};

/**
 * 2026-08 owner 결정(위 `CollectionIncrementalStatusSnapshotDto` 참고) — ADMIN 전용
 * system-status 화면이 저장소·stream 단위 상세를 보여줄 수 있도록 새로 연 경계. `bucket`은
 * `getIncrementalStatusSnapshot`의 집계와 같은 분류를 stream 하나 단위로 반복한다:
 * `lastErrorCode`가 있으면(재시도 대기) status를 덮어써 `RETRY_PENDING`이 최우선이고
 * (system-status의 `decide()`가 retryPending을 partial/backfilling보다 먼저 보는 것과
 * 같은 우선순위), 그다음 `READY`/`BACKFILLING`, 나머지(PENDING·VERIFYING·아직 생성되지
 * 않은 stream row)는 `PARTIAL`이다.
 */
export const COLLECTION_STREAM_DETAIL_BUCKETS = [
  'READY',
  'BACKFILLING',
  'PARTIAL',
  'RETRY_PENDING',
] as const;
export type CollectionStreamDetailBucketDto =
  (typeof COLLECTION_STREAM_DETAIL_BUCKETS)[number];

export type CollectionRepositoryStreamDetailDto = {
  readonly streamType: CollectionStreamType;
  readonly bucket: CollectionStreamDetailBucketDto;
  readonly lastSuccessAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAt: Date | null;
};

/**
 * 저장소↔프로그램 연결 노출 — `programId`는 `GithubRepository`(수집 모델) 자신의
 * 컬럼이다(#617 단계 D부터; 그 전에는 별도 프로비저닝 모델 `Repository`가
 * `programId`와 `githubRepositoryId`를 unique 컬럼 경유 조인으로 따로 들고 있었다).
 * `program-activity.service.ts`/`program-activity-summary.service.ts`/
 * `programs.repository.ts`가 이미 이 컬럼을 직접 쓴다.
 *
 * 이 필드는 `getIncrementalStatusStreams`가 채우는데, 그 메서드는 애초에
 * `PRESENT_REPOSITORY`(org 저장소, `source: 'ORG_PROVISIONED'`)로 대상을
 * 고정한다 — external 저장소(`source: 'EXTERNAL_PUBLIC'`)는 이 DTO의 행
 * 자체로 나타나지 않는다(org sweep·external sweep은 서로의 source를 건드리지
 * 않아 전환 경로가 없다). 그래서 `programName`이 `null`인 org 저장소는 "이
 * 저장소의 `programId`가 null이다"(예: 신청 승인 경로를 거치지 않고 관리자가
 * 직접 만든 저장소)는 뜻이지만, external 저장소가 이 표에 아예 안 보이는
 * 것은 "programId가 없다"가 아니라 "행 자체가 없다" — 원인이 다르다.
 * 이 필드 하나로는 학생 개인(external) 저장소의 프로그램 소속을 알 수 없다.
 */
export type CollectionRepositoryStreamsDto = {
  readonly repositoryName: string;
  readonly programName: string | null;
  readonly streams: readonly CollectionRepositoryStreamDetailDto[];
};

/**
 * 시스템 상태 관측성 2단계 — sweep 1회 종료 시점의 활동 이력(`CollectionSweepHistory`)
 * 한 행의 읽기 표현. 집계 전용이다 — repository 이름을 포함하지 않는다.
 */
export type CollectionSweepActivityDto = {
  readonly sweepFinishedAt: Date;
  readonly cycleStartedAt: Date | null;
  readonly scope: string;
  readonly insertedCommitCount: number;
  readonly insertedPullRequestCount: number;
  readonly insertedReleaseCount: number;
  readonly attemptedRepositoryCount: number;
  readonly processedRepositoryCount: number;
  readonly failedRepositoryCount: number;
  readonly cycleCompleted: boolean;
  readonly stoppedForBudget: boolean;
};

/**
 * 시스템 상태 3단계 — org sweep과 별개인 external(학생 개인 공개 저장소,
 * `source: 'EXTERNAL_PUBLIC'`) 수집 현황.
 *
 * `trackedRepositoryCount`가 0이어도 sweep 파이프라인 자체는 정상 작동 중일 수
 * 있다는 점이 이 DTO의 핵심이다 — `CollectionSchedulerService.handleCron()`이
 * org sweep과 함께 external sweep(`collection-sync.service.ts`의
 * `runExternal`, scope 고정값 `"external"`)도 매시 자동 실행하지만, `EXTERNAL_PUBLIC`
 * 행을 만드는 저장소 발견(discovery, `collection-external-discovery.service.ts`)은
 * 관리자가 학생별로 수동 실행해야 하는 별개 단계다. 대상이 0건이면 sweep이 정상
 * 실행되어도 수집할 것이 없을 뿐이다 — `lastSweep`이 그 구분을 드러낸다.
 *
 * `cumulativeCommitCount`/`cumulativePullRequestCount`/`cumulativeReleaseCount`는
 * `CollectionSweepHistory`의 scope `"external"` 행을 합산한 값이다. `Contribution`을
 * 저장소별로 다시 훑는 대신 이미 기록된 sweep 결과를 더하는 저렴한 방식을 택했다 —
 * sweep 이력이 보관되는 기간을 넘어서면 그 이전 활동은 반영되지 않는다.
 */
export type CollectionExternalCollectionStatusDto = {
  readonly trackedRepositoryCount: number;
  readonly lastSweep: CollectionSweepActivityDto | null;
  readonly cumulativeCommitCount: number;
  readonly cumulativePullRequestCount: number;
  readonly cumulativeReleaseCount: number;
};

export interface CollectionReadPort {
  findRepositoryActivity(
    query: CollectionRepositoryActivityQueryDto,
  ): Promise<readonly CollectionRepositoryActivityDto[]>;
  findRankingActivity(
    query: CollectionRankingActivityQueryDto,
  ): Promise<readonly CollectionRankingActivityDto[]>;
  getStatusSnapshot(): Promise<CollectionStatusSnapshotDto | null>;
  /** todo 11 — 증분 facts에서 deterministic rebuild된 저장소별 연도 누적. */
  getRepositoryMetrics(
    query: CollectionRepositoryMetricsQueryDto,
  ): Promise<readonly CollectionRepositoryMetricsDto[]>;
  /** todo 11 — 증분 facts에서 deterministic rebuild된 기여자별 연도 누적(ranking source). */
  getContributorMetrics(
    query: CollectionContributorMetricsQueryDto,
  ): Promise<readonly CollectionContributorMetricsDto[]>;
  /**
   * todo 19 — ranking 공개 페이지 전용 질의. `getContributorMetrics`와 같은 증분 소스
   * (`Contribution`)을 읽되, PUBLIC + PRESENT 저장소만 port 경계에서
   * 필터링하고 githubId(githubUserId) 단위로 저장소·연도를 넘어 합산해 이미 병합된 행을
   * 반환한다 — private facts·platform User join·실명 없이 githubLogin만 노출한다.
   * `currentYear`를 생략하면 전체 기간 누적, 지정하면 해당 연도만 반환한다.
   */
  getPublicRankingMetrics(
    query: CollectionPublicRankingMetricsQueryDto,
  ): Promise<readonly CollectionPublicRankingMetricsDto[]>;
  /**
   * Distinct calendar years that have public ranking activity on PUBLIC + PRESENT
   * repositories (desc). Empty years are omitted — shell year sidebar only.
   */
  listPublicRankingYears(): Promise<readonly number[]>;

  /**
   * 공개 랭킹 수치가 언제 기준인지 (ADR-010 §10).
   *
   * 랭킹 목록과 **따로** 묻는다. 목록 수치와 수집 성공 시각은 서로 다른
   * 의미이므로 한 응답을 만들 때 각각 현재 DB 상태에서 읽는다.
   *
   * 관측된 공개 기여가 하나도 없으면 `null`.
   */
  getPublicRankingDataAsOf(): Promise<Date | null>;
  /** todo 12 — 조직 전체 증분 collection의 per-repo/stream 진행 상황 집계(system-status source). */
  getIncrementalStatusSnapshot(): Promise<CollectionIncrementalStatusSnapshotDto>;
  /**
   * 2026-08 owner 결정 — ADMIN 전용 system-status 화면의 저장소·stream 단위 상세
   * (`CollectionRepositoryStreamDetailDto` 참고). 추적 중인(=`getIncrementalStatusSnapshot`의
   * `trackedRepositoryCount`와 같은 조건) 저장소 전체를 repositoryName 오름차순으로,
   * 저장소마다 COMMIT/PULL_REQUEST/RELEASE 3개 stream을 고정 순서로 반환한다 — stream row가
   * 아직 생성되지 않은 조합도 PARTIAL bucket으로 채워 나온다.
   */
  getIncrementalStatusStreams(): Promise<
    readonly CollectionRepositoryStreamsDto[]
  >;
  /** todo 16 — 공개 프로젝트 상세/프로필 배치 지표(연도 무관 lifetime 누적). */
  getRepositoryCumulativeMetrics(
    query: CollectionRepositoryCumulativeMetricsQueryDto,
  ): Promise<readonly CollectionRepositoryCumulativeMetricsDto[]>;
  /** todo 16 — 공개 프로젝트 상세 기여자 배치 지표(연도 무관 lifetime 누적, githubLogin만 노출). */
  getContributorCumulativeMetrics(
    query: CollectionContributorCumulativeMetricsQueryDto,
  ): Promise<readonly CollectionContributorCumulativeMetricsDto[]>;
  /**
   * ADR-003 DEC-42 — system-status(github 모듈 밖)는 실제 배선된 cron 표현식
   * (`collection-scheduler.service.ts`의 `COLLECTION_CRON_EXPRESSION`, concrete 구현)을
   * 직접 import할 수 없다(boundary lint). 다음 수집 사이클 예정 시각 계산을 이 포트
   * 뒤로 옮겨, cron 표현식과 `CronTime` 사용을 github 모듈 안(`collection-read.service.ts`)
   * 에만 알게 한다. `from` 이후 다음 발생 시각을 Asia/Seoul 기준으로 계산하고, 표현식이
   * 유효하지 않으면(운영 실수) `null`을 반환한다 — 이 계산 실패가 나머지 system-status
   * 응답을 막아서는 안 된다.
   */
  getNextScheduledCycleAt(from: Date): Promise<Date | null>;
  /**
   * 시스템 상태 관측성 2단계 — 최근 sweep 활동 이력을 `sweepFinishedAt` 내림차순으로
   * 최대 `limit`건 반환한다 (`CollectionSweepHistory`). repository 이름은 담지 않는다
   * (집계 전용).
   */
  getRecentSweepActivity(
    limit: number,
  ): Promise<readonly CollectionSweepActivityDto[]>;
  /**
   * 시스템 상태 3단계 — external(학생 개인 공개 저장소) 수집 현황
   * (`CollectionExternalCollectionStatusDto` 참고).
   */
  getExternalCollectionStatus(): Promise<CollectionExternalCollectionStatusDto>;
}

/**
 * 통합 테스트 전용 팩토리 — collection 모듈 밖 소비자 통합 테스트는 Nest DI 없이
 * `new`로 직접 조립하는 관행을 쓰는데(ADR-003 DEC-42로 concrete 구현은 모듈 밖 import가
 * 금지돼 있다), 이 팩토리가 그 경계를 지키면서 실제 Postgres에 대해 동작하는 진짜
 * `CollectionReadPort` 구현을 이 파일(공개 surface) 하나로 노출한다. 인터페이스 자체는
 * 바뀌지 않았으므로 기존 mock spec은 전혀 영향받지 않는다.
 */
export function createCollectionReadPortForIntegrationTest(
  prisma: PrismaService,
): CollectionReadPort {
  return new CollectionReadService(
    prisma,
    new CollectionCanonicalRepository(prisma),
    new PublicRankingRepository(prisma),
  );
}
