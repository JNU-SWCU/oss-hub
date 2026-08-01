/**
 * ADR-006 조직 전체 누적·증분 수집(canonical contract)의 저장 계층 타입.
 * App installation id는 논리 저장소 identity에 포함하지 않는다 — App 교체와 무관하게
 * (githubOrganizationId, githubRepositoryId)만으로 저장소를 식별한다.
 */

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

/** complete inventory 관찰 1건 — visibility/presence는 이 경로에서만 갱신된다(DEC-46). */
export interface RecordRepositoryObservationInput {
  githubOrganizationId: bigint;
  githubRepositoryId: bigint;
  fullName: string;
  defaultBranch: string;
  archived: boolean;
  visibility: CollectionRepositoryVisibility;
  presence: CollectionRepositoryPresence;
  observedAt: Date;
}

export interface CollectionRepositoryRow {
  id: string;
  githubOrganizationId: bigint;
  githubRepositoryId: bigint;
  fullName: string;
  defaultBranch: string;
  archived: boolean;
  visibility: CollectionRepositoryVisibility;
  presence: CollectionRepositoryPresence;
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

export interface SyncCursorInput {
  appId: bigint;
  organizationLogin: string;
  lastGithubRepositoryId?: bigint | null;
  cycleStartedAt?: Date | null;
  cycleCompletedAt?: Date | null;
}

export interface SyncCursorRow {
  appId: bigint;
  organizationLogin: string;
  lastGithubRepositoryId: bigint | null;
  cycleStartedAt: Date | null;
  cycleCompletedAt: Date | null;
}
