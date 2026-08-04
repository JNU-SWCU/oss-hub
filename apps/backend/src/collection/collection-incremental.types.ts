/**
 * ADR-006 조직 전체 누적·증분 수집(canonical contract)의 저장 계층 타입.
 * 논리 저장소 identity는 `githubRepositoryId` 단독 unique key다 — GitHub repository id는
 * App/organization 소속과 무관하게 전역에서 유일하므로 App 교체는 물론 조직 소속 여부
 * (org-provisioned vs. 학생이 등록한 external public repo)와도 무관하게 저장소를 식별한다.
 * `source`가 그 소속을 구분한다: `ORG_PROVISIONED`(installation listing으로 발견) vs.
 * `EXTERNAL_PUBLIC`(학생이 등록한 조직 밖 public repo) — external repo는 organization
 * installation에 속하지 않으므로 `githubOrganizationId`가 null이다.
 */

/** GithubRepository 행의 발견 경로 — ABSENT 판정·랭킹 노출 필터 등에서 이 값으로 갈린다. */
export const REPOSITORY_SOURCES = ['ORG_PROVISIONED', 'EXTERNAL_PUBLIC'] as const;
export type RepositorySource = (typeof REPOSITORY_SOURCES)[number];

export const COLLECTION_STREAM_TYPES = [
  'COMMIT',
  'PULL_REQUEST',
  'RELEASE',
] as const;
export type CollectionStreamType = (typeof COLLECTION_STREAM_TYPES)[number];

export const COLLECTION_STREAM_STATUSES = [
  'PENDING',
  'BACKFILLING',
  'READY',
  'VERIFYING',
] as const;
export type CollectionStreamStatus =
  (typeof COLLECTION_STREAM_STATUSES)[number];

export const COLLECTION_REPOSITORY_PRESENCE = ['PRESENT', 'ABSENT'] as const;
export type CollectionRepositoryPresence =
  (typeof COLLECTION_REPOSITORY_PRESENCE)[number];

export type CollectionRepositoryVisibility = 'PRIVATE' | 'PUBLIC';

/**
 * complete inventory 관찰 1건 — visibility/presence는 이 경로에서만 갱신된다(DEC-46).
 * `githubOrganizationId`는 `source: 'EXTERNAL_PUBLIC'`일 때 null이다(조직 installation
 * 밖의 저장소이므로 관측 시점에 organization id 자체가 없다). `defaultBranch`도 null일 수
 * 있다(빈 저장소 — 커밋이 하나도 없으면 GitHub이 default branch를 보고하지 않는다).
 */
export interface RecordRepositoryObservationInput {
  githubOrganizationId: bigint | null;
  githubRepositoryId: bigint;
  nameWithOwner: string;
  defaultBranch: string | null;
  archived: boolean;
  visibility: CollectionRepositoryVisibility;
  presence: CollectionRepositoryPresence;
  source: RepositorySource;
  observedAt: Date;
}

export interface CollectionRepositoryRow {
  id: string;
  githubOrganizationId: bigint | null;
  githubRepositoryId: bigint;
  nameWithOwner: string;
  defaultBranch: string | null;
  archived: boolean;
  visibility: CollectionRepositoryVisibility;
  presence: CollectionRepositoryPresence;
  source: RepositorySource;
  lastCompleteInventoryObservedAt: Date | null;
}

export interface CommitFactInput {
  sha: string;
  committedAt: Date;
  authorGithubId?: bigint | null;
  authorGithubLogin?: string | null;
}

export interface PullRequestFactInput {
  githubPullRequestId: bigint;
  state: string;
  createdAt: Date;
  authorGithubId?: bigint | null;
  authorGithubLogin?: string | null;
}

export interface ReleaseFactInput {
  githubReleaseId: bigint;
  publishedAt: Date;
  authorGithubId?: bigint | null;
  authorGithubLogin?: string | null;
}

/** 새로 기록된 fact 수 — 중복(이미 존재하는 unique key)은 집계되지 않는다. */
export interface RecordFactsResult {
  insertedCount: number;
}

export interface StreamFrontierInput {
  repositoryId: string;
  streamType: CollectionStreamType;
  status?: CollectionStreamStatus;
  frontierSha?: string | null;
  frontierCreatedAt?: Date | null;
  frontierEntityId?: bigint | null;
  requestFingerprint?: string | null;
  etag?: string | null;
  lastRunAt?: Date;
  lastErrorAt?: Date | null;
  lastErrorCode?: string | null;
}

export interface StreamFrontierRow {
  repositoryId: string;
  streamType: CollectionStreamType;
  status: CollectionStreamStatus;
  frontierSha: string | null;
  frontierCreatedAt: Date | null;
  frontierEntityId: bigint | null;
  requestFingerprint: string | null;
  etag: string | null;
  lastRunAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
}

export interface RepositoryYearAggregateRow {
  repositoryId: string;
  year: number;
  commitCount: number;
  pullRequestCount: number;
  releaseCount: number;
}

export interface ContributorYearAggregateRow {
  repositoryId: string;
  githubUserId: bigint;
  githubLogin: string;
  year: number;
  commitCount: number;
  pullRequestCount: number;
  releaseCount: number;
}

/** 존재하지 않는 연도는 0으로 채운 기본값 — 매년 1/1에 당해 연도 read가 실패하지 않는다. */
export const zeroRepositoryYearAggregate = (
  repositoryId: string,
  year: number,
): RepositoryYearAggregateRow => ({
  repositoryId,
  year,
  commitCount: 0,
  pullRequestCount: 0,
  releaseCount: 0,
});

/**
 * `scope`는 이 cursor가 어느 sweep에 속하는지를 나타내는 일반화된 키다 — org sweep은
 * `` `org:${organizationLogin}` `` 관례를 쓰고, external sweep은 고정 문자열 `"external"`을
 * 쓴다. 두 sweep은 서로 다른 cursor 행을 가지므로 external sweep이 org sweep의 진행
 * 상태(`lastGithubRepositoryId`)를 갈아엎거나 그 반대가 되는 일이 없다.
 */
export interface SyncCursorInput {
  appId: bigint;
  scope: string;
  lastGithubRepositoryId?: bigint | null;
  cycleStartedAt?: Date | null;
  cycleCompletedAt?: Date | null;
}

export interface SyncCursorRow {
  appId: bigint;
  scope: string;
  lastGithubRepositoryId: bigint | null;
  cycleStartedAt: Date | null;
  cycleCompletedAt: Date | null;
}
