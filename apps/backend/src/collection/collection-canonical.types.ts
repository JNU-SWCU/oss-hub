export const CANONICAL_RUN_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'INCOMPLETE',
  'RATE_LIMITED',
  'FAILED',
] as const;

export type CanonicalRunStatus = (typeof CANONICAL_RUN_STATUSES)[number];
export type CanonicalFailureStatus = Extract<
  CanonicalRunStatus,
  'INCOMPLETE' | 'RATE_LIMITED' | 'FAILED'
>;

export interface CanonicalLeaseKey {
  appId: bigint;
  organizationLogin: string;
}

export interface CanonicalLeaseToken extends CanonicalLeaseKey {
  ownerId: string;
  epoch: bigint;
  runId: string;
  expiresAt: Date;
}

export interface AcquireCanonicalLeaseInput extends CanonicalLeaseKey {
  ownerId: string;
  runId: string;
  now: Date;
  expiresAt: Date;
}

export interface CanonicalRepositoryRow {
  githubRepositoryId: bigint;
  fullName: string;
  visibility: string;
  archived: boolean;
  defaultBranch: string;
}

export interface CanonicalCommitRow {
  githubRepositoryId: bigint;
  sha: string;
  committedAt: Date;
  authorGithubId?: bigint;
  authorGithubLogin?: string;
}

export interface CanonicalPullRequestRow {
  githubRepositoryId: bigint;
  githubPullRequestId: bigint;
  state: string;
  createdAt: Date;
  authorGithubId: bigint | null;
  authorGithubLogin: string | null;
}

export interface CanonicalReleaseRow {
  githubRepositoryId: bigint;
  githubReleaseId: bigint;
  publishedAt: Date;
  authorGithubId: bigint | null;
  authorGithubLogin: string | null;
}

export interface CanonicalContributorRow {
  githubRepositoryId: bigint;
  githubUserId: bigint;
  githubLogin: string;
  commitCount: number;
  pullRequestCount: number;
  releaseCount: number;
  currentYear: number;
  currentYearCommitCount: number;
  currentYearPullRequestCount: number;
  currentYearReleaseCount: number;
}

export interface CanonicalGenerationInventory {
  repositories: CanonicalRepositoryRow[];
  commits: CanonicalCommitRow[];
  pullRequests: CanonicalPullRequestRow[];
  releases: CanonicalReleaseRow[];
  contributors: CanonicalContributorRow[];
}

export interface CanonicalStatusSnapshot extends CanonicalLeaseKey {
  activeGenerationId: string | null;
  installationValid: boolean;
  permissionsValid: boolean;
  runId: string | null;
  runStatus: CanonicalRunStatus | null;
  errorClass: string | null;
  updatedAt: Date;
}

/**
 * Commit row shape for read paths (todo 8 generation import). Unlike
 * `CanonicalCommitRow` (write-side, uses `undefined` as its author-pair
 * sentinel), a row read back from Postgres reports absent authors as `null`.
 */
export interface CanonicalCommitSnapshotRow {
  githubRepositoryId: bigint;
  sha: string;
  committedAt: Date;
  authorGithubId: bigint | null;
  authorGithubLogin: string | null;
}

/**
 * Full read-side projection of one published (`activeGenerationId`) canonical
 * generation — the source the todo 8 import command converts into stable-ID
 * facts. Contributor projections are intentionally omitted: they are a
 * derived, mutable-column snapshot (the anti-pattern the new year-aggregate
 * tables replace), and importing them would risk diverging from facts
 * recomputed straight from commits/pull requests/releases.
 */
export interface CanonicalGenerationSnapshot {
  runId: string;
  finishedAt: Date;
  repositories: CanonicalRepositoryRow[];
  commits: CanonicalCommitSnapshotRow[];
  pullRequests: CanonicalPullRequestRow[];
  releases: CanonicalReleaseRow[];
}
