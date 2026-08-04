import type {
  CollectionRepositoryPresence,
  CollectionRepositoryVisibility,
} from './collection-incremental.types';
import type { PrismaService } from '../prisma/prisma.service';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
import { CollectionReadService } from './collection-read.service';

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
  readonly prCount: number;
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
 * todo 11 — 신규 증분 aggregate 소스(`CollectionRepositoryYearAggregate`)를 읽는 배치 질의.
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
 * todo 16 — `getRepositoryMetrics`(연도 한정)와 달리 `CollectionRepositoryYearAggregate`의
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
};

/**
 * todo 16 — `getContributorMetrics`(연도 한정)와 달리 `CollectionContributorYearAggregate`의
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
  readonly prCount: number;
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
   * (`CollectionContributorYearAggregate`)를 읽되, PUBLIC + PRESENT 저장소만 port 경계에서
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
  /** todo 12 — 조직 전체 증분 collection의 per-repo/stream 진행 상황 집계(system-status source). */
  getIncrementalStatusSnapshot(): Promise<CollectionIncrementalStatusSnapshotDto>;
  /** todo 16 — 공개 프로젝트 상세/프로필 배치 지표(연도 무관 lifetime 누적). */
  getRepositoryCumulativeMetrics(
    query: CollectionRepositoryCumulativeMetricsQueryDto,
  ): Promise<readonly CollectionRepositoryCumulativeMetricsDto[]>;
  /** todo 16 — 공개 프로젝트 상세 기여자 배치 지표(연도 무관 lifetime 누적, githubLogin만 노출). */
  getContributorCumulativeMetrics(
    query: CollectionContributorCumulativeMetricsQueryDto,
  ): Promise<readonly CollectionContributorCumulativeMetricsDto[]>;
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
  );
}
