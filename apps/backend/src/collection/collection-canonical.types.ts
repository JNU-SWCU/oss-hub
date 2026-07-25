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
