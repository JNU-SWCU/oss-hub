export type ProjectApplicationMode = 'PERSONAL' | 'TEAM';

export type ProjectTrackType = 'CURRICULAR' | 'EXTRACURRICULAR';

export type ProjectDetail = {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly trackType: ProjectTrackType | null;
  readonly applicationMode: ProjectApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly publishedLabel: string;
  readonly metrics: ProjectMetrics;
  readonly contributors: readonly ProjectContributor[];
};

export type ProjectMetrics = {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
};

export type ProjectContributor = {
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly githubProfileUrl: string;
};

export type ProjectDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ready'; readonly project: ProjectDetail };
