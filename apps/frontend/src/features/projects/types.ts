export type ArchiveApplicationMode = 'PERSONAL' | 'TEAM';

export type ArchiveTrackType = 'CURRICULAR' | 'EXTRACURRICULAR';

export type ArchiveYears = {
  readonly years: readonly number[];
};

export type ArchiveListItem = {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly trackType: ArchiveTrackType | null;
  readonly applicationMode: ArchiveApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly detailUrl: string;
  readonly modeLabel: '개인' | '팀';
  readonly publishedLabel: string;
};

export type ArchivePage = {
  readonly items: readonly ArchiveListItem[];
  readonly pageSize: number;
  readonly nextPageId: string | null;
};

export type ArchiveMetrics = {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
};

export type ArchiveContributor = {
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly githubProfileUrl: string;
};

export type ArchiveDetail = Omit<ArchiveListItem, 'detailUrl'> & {
  readonly metrics: ArchiveMetrics;
  readonly contributors: readonly ArchiveContributor[];
};

export type ArchiveDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ready'; readonly archive: ArchiveDetail };
