export interface RepositoryContributorView {
  readonly githubId: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

export interface TeamRepositoryContributionsView {
  readonly repositoryId: string;
  readonly repositoryUrl: string;
  readonly window: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: 'Asia/Seoul';
  };
  readonly collectionStatus: 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR';
  readonly lastSuccessAt: string | null;
  readonly members: readonly (RepositoryContributorView & {
    readonly userId: string;
    readonly hasObservations: boolean;
  })[];
  readonly unmatchedContributors: readonly RepositoryContributorView[];
}

export interface RepositoryUrlHistoryView {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorGithubLogin: string;
  readonly previousRepositoryUrl: string | null;
  readonly newRepositoryUrl: string;
  readonly reason: string;
}

export interface TeamRepositoryEvidenceView {
  readonly repositoryContributions: TeamRepositoryContributionsView | null;
  readonly repositoryUrlHistory: RepositoryUrlHistoryPage;
}

export interface RepositoryUrlHistoryPage {
  readonly items: readonly RepositoryUrlHistoryView[];
  readonly nextCursor: string | null;
}

export interface RepositoryUrlHistoryCursor {
  readonly occurredAt: Date;
  readonly id: string;
}
