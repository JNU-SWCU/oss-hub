export const REPOSITORY_SOURCES = [
  'ORG_PROVISIONED',
  'EXTERNAL_PUBLIC',
] as const;
export type RepositorySource = (typeof REPOSITORY_SOURCES)[number];

export const COLLECTION_STREAM_TYPES = [
  'COMMIT',
  'PULL_REQUEST',
  'RELEASE',
  'ISSUE',
] as const;
export type CollectionStreamType = (typeof COLLECTION_STREAM_TYPES)[number];

export type CollectionRunKind = 'SWEEP' | 'REPOSITORY_LINK';

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

  nextRunAt?: Date | null;

  failureCount?: number;

  applicationId?: string | null;
  programId?: string | null;
  teamId?: string | null;
}

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

export interface IssueFactInput {
  githubIssueId: bigint;
  state: string;
  createdAt: Date;
  authorGithubId?: bigint | null;
  authorGithubLogin?: string | null;
}

export type RegisteredGithubIdSet = ReadonlySet<bigint>;

export interface RecordFactsResult {
  readonly acceptedCount: number;
  readonly insertedCount: number;
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

export interface RecordSweepHistoryInput {
  appId: bigint;
  scope: string;
  kind: CollectionRunKind;
  sweepFinishedAt: Date;
  cycleStartedAt: Date | null;
  insertedCommitCount: number;
  insertedPullRequestCount: number;
  insertedReleaseCount: number;
  insertedIssueCount: number;
  attemptedRepositoryCount: number;
  processedRepositoryCount: number;
  failedRepositoryCount: number;
  cycleCompleted: boolean;
  stoppedForBudget: boolean;
}

export type CollectionSyncRunTrigger = 'CRON' | 'MANUAL' | 'CLI' | 'UNKNOWN';

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

  startedAt: Date | null;

  lastObservedAt: Date;
  cycleCompletedAt: Date | null;
  streams: CollectionSyncStreamSummary;

  errorCodes: readonly string[];
}
