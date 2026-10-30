import type { ActivityCounts } from '../../common/domain/activity-counts';

export interface RankingCandidate extends ActivityCounts {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly total: number;
}

export function compareRankingCandidates(
  left: RankingCandidate,
  right: RankingCandidate,
): number {
  const normalizedLoginOrder = normalizeLogin(left.githubLogin).localeCompare(
    normalizeLogin(right.githubLogin),
    'en-US',
  );
  return (
    right.total - left.total ||
    right.commitCount - left.commitCount ||
    right.pullRequestCount - left.pullRequestCount ||
    right.issueCount - left.issueCount ||
    right.repositoryCount - left.repositoryCount ||
    right.starCount - left.starCount ||
    normalizedLoginOrder ||
    compareGithubIds(left.githubId, right.githubId)
  );
}

function normalizeLogin(githubLogin: string): string {
  return githubLogin.normalize().toLocaleLowerCase('en-US');
}

function compareGithubIds(left: bigint, right: bigint): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
