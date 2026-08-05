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
export const REPOSITORY_SOURCES = [
  'ORG_PROVISIONED',
  'EXTERNAL_PUBLIC',
] as const;
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

/**
 * 저장소를 소유한 팀의 팀원 GitHub 계정 하나. `TeamMember.userId`가 `User` FK를 강제하므로
 * 팀원은 정의상 전부 가입자이며, 여기 나오는 두 값은 항상 존재한다(nullable 아님).
 * 커밋 수집을 author-scoped로 좁히는 데만 쓰인다 — 외부 기여자는 이 목록에 절대 없다.
 */
export interface RepositoryTeamMemberAccount {
  githubId: bigint;
  nickname: string;
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

/**
 * #511 — sync 실행 이력의 **프로젝션**. 이번 웨이브는 스키마 무접촉이 전제이므로 별도 run
 * 테이블을 만들지 않고 이미 있는 세 소스(`CollectionSyncLease`·`CollectionSyncCursor`·
 * `CollectionRepositoryStream`)를 합성한다.
 *
 * 그래서 갖는 한계를 명시한다: `CollectionSyncLease`는 (appId, scope)당 **한 행만** 유지하며
 * run마다 그 행을 덮어쓴다. 따라서 이 프로젝션이 답할 수 있는 것은 "scope별 가장 최근 run"
 * 하나뿐이고, 진짜 "최근 N회" 이력은 append 되는 run 테이블 없이는 복원할 수 없다.
 */
export type CollectionSyncRunTrigger = 'CRON' | 'MANUAL' | 'CLI' | 'UNKNOWN';

/**
 * `RUNNING`은 lease가 아직 만료되지 않은 상태(진행 중), `FAILED`는 이 scope의 stream 중
 * `lastErrorCode`가 남아 있는 것이 있는 상태, 그 밖은 `COMPLETED`다. 사이클이 끝까지 돌았는지는
 * 별도 `cycleCompletedAt`으로 구분한다 — budget으로 중간에 멈춘 run도 실패는 아니기 때문이다.
 */
export type CollectionSyncRunStatusProjection =
  'RUNNING' | 'FAILED' | 'COMPLETED';

export interface CollectionSyncStreamSummary {
  readyCount: number;
  backfillingCount: number;
  pendingCount: number;
  verifyingCount: number;
  failedCount: number;
}

export interface CollectionSyncRunRow {
  runId: string;
  scope: string;
  trigger: CollectionSyncRunTrigger;
  status: CollectionSyncRunStatusProjection;
  /** 이 scope의 현재 사이클 시작 시각(`CollectionSyncCursor.cycleStartedAt`). */
  startedAt: Date | null;
  /** lease가 마지막으로 갱신·해제된 시각 — 진행 중이면 마지막 heartbeat, 끝났으면 종료 시각. */
  lastObservedAt: Date;
  cycleCompletedAt: Date | null;
  streams: CollectionSyncStreamSummary;
  /** 이 scope의 stream에 남아 있는 `lastErrorCode`의 중복 없는 목록(사전순). */
  errorCodes: readonly string[];
}
