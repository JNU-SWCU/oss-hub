export type ProjectApplicationMode = 'PERSONAL' | 'TEAM';

export type ProjectTrackType = 'CURRICULAR' | 'EXTRACURRICULAR';

export type ProjectYears = {
  readonly years: readonly number[];
};

export type ProjectListItem = {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly trackType: ProjectTrackType | null;
  readonly applicationMode: ProjectApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly detailUrl: string;
  readonly modeLabel: '개인' | '팀';
  readonly publishedLabel: string;
};

export type ProjectPage = {
  readonly items: readonly ProjectListItem[];
  readonly pageSize: number;
  readonly nextPageId: string | null;
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

export type ProjectDetail = Omit<ProjectListItem, 'detailUrl'> & {
  readonly metrics: ProjectMetrics;
  readonly contributors: readonly ProjectContributor[];
};

export type ProjectDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ready'; readonly project: ProjectDetail };
