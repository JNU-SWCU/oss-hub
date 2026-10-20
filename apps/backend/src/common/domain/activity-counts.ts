export interface ActivityCounts {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export function activityTotal(activity: ActivityCounts): number {
  return (
    activity.commitCount +
    activity.pullRequestCount +
    activity.issueCount +
    activity.repositoryCount +
    activity.starCount
  );
}
