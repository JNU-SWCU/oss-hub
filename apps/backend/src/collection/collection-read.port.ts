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

export interface CollectionReadPort {
  findRepositoryActivity(
    query: CollectionRepositoryActivityQueryDto,
  ): Promise<readonly CollectionRepositoryActivityDto[]>;
  findRankingActivity(
    query: CollectionRankingActivityQueryDto,
  ): Promise<readonly CollectionRankingActivityDto[]>;
  getStatusSnapshot(): Promise<CollectionStatusSnapshotDto | null>;
}
