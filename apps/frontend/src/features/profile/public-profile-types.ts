export type PublicProfileApplicationMode = 'PERSONAL' | 'TEAM';

export type PublicProfileTrackType = 'CURRICULAR' | 'EXTRACURRICULAR';

export type PublicProfileMetrics = {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
};

export type PublicProfileProject = {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly trackType: PublicProfileTrackType | null;
  readonly applicationMode: PublicProfileApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly detailUrl: string;
  readonly modeLabel: '개인' | '팀';
  readonly publishedLabel: string;

  readonly observed: boolean;

  readonly hasCollectedData: boolean;
  readonly dataAsOf: string | null;

  readonly metrics: PublicProfileMetrics | null;
};

export type PublicProfile = {
  readonly userId: string;
  readonly githubNickname: string;
  readonly avatarUrl: string | null;
  readonly projects: readonly PublicProfileProject[];

  readonly observedTotals: PublicProfileMetrics;
};

export type PublicProfileState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ready'; readonly profile: PublicProfile };
