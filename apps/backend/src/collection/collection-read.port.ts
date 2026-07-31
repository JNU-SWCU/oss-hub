import type {
  CollectionRepositoryPresence,
  CollectionRepositoryVisibility,
} from './collection-incremental.types';

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
   * `currentYear`를 생략하면 전체 기간 누적(ALL), 지정하면 해당 연도만(THIS_YEAR) 반환한다.
   */
  getPublicRankingMetrics(
    query: CollectionPublicRankingMetricsQueryDto,
  ): Promise<readonly CollectionPublicRankingMetricsDto[]>;
}
