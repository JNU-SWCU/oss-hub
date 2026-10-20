export const TEAM_ACTIVITY_METRICS = [
  'commitCount',
  'pullRequestCount',
  'issueCount',
] as const;

export type TeamActivityMetric = (typeof TEAM_ACTIVITY_METRICS)[number];

export type TeamActivityCounts = Readonly<Record<TeamActivityMetric, number>>;

interface TeamActivityPoint extends TeamActivityCounts {
  readonly date: string;
}

export interface TeamActivityMember {
  readonly userId: string;
  readonly githubLogin: string;

  readonly totals: TeamActivityCounts;
  readonly points: readonly TeamActivityPoint[];
}

export type TeamActivityStatus =
  'NOT_CONNECTED' | 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR';

export interface TeamActivity {
  readonly applicationId: string | null;
  readonly repository: { readonly id: string; readonly url: string } | null;
  readonly status: TeamActivityStatus;
  readonly lastSuccessAt: string | null;

  readonly window: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: 'Asia/Seoul';
  };
  readonly canEditRepositoryUrl: boolean;
  readonly members: readonly TeamActivityMember[];
}

export interface RepositoryHistoryItem {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorGithubLogin: string;
  readonly previousRepositoryUrl: string | null;
  readonly newRepositoryUrl: string;
}

export interface RepositoryHistoryPage {
  readonly items: readonly RepositoryHistoryItem[];
  readonly nextCursor: string | null;
}
