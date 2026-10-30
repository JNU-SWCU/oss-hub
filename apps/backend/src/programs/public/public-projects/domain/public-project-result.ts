import type {
  PublicProjectRow,
  PublicUserIdentity,
} from './public-project-record';

export interface PublicProjectPageResult {
  readonly items: readonly PublicProjectRow[];
  readonly pageSize: number;
  readonly nextPageId: string | null;
}

export interface PublicProjectMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

export interface PublicProjectContributor {
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

export interface PublicProjectDetailResult {
  readonly row: PublicProjectRow;
  readonly metrics: PublicProjectMetrics;
  readonly contributors: readonly PublicProjectContributor[];
}

export interface PublicUserProfileProjectResult {
  readonly row: PublicProjectRow;
  readonly observed: boolean;
  readonly hasCollectedData: boolean;
  readonly dataAsOf: Date | null;
  readonly metrics: PublicProjectMetrics | null;
}

export interface PublicUserProfileResult {
  readonly identity: PublicUserIdentity;
  readonly projects: readonly PublicUserProfileProjectResult[];

  readonly observedTotals: PublicProjectMetrics;
}
