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
