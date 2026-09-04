export type ArchiveApplicationMode = 'PERSONAL' | 'TEAM';

export type ArchiveTrackType = 'CURRICULAR' | 'EXTRACURRICULAR';

export const ARCHIVE_TRACK_TYPE_LABELS = {
  CURRICULAR: '교과',
  EXTRACURRICULAR: '비교과',
} as const satisfies Record<ArchiveTrackType, string>;

/** 사이드 패널·칩 공용. `all`은 쿼리 없이 `/archive`. */
export type ArchiveListFilter = 'all' | number;

export function archiveListHref(filter: ArchiveListFilter): string {
  if (filter === 'all') return '/archive';
  return `/archive?year=${filter}`;
}

export function parseArchiveListFilter(
  value: string | null,
): ArchiveListFilter {
  if (value === null || value === '') return 'all';
  const year = Number(value);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
    return year;
  }
  return 'all';
}

/** `GET /projects/years` — 데이터가 있는 연도(최신순). */
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

export type ArchiveListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly page: ArchivePage };

export type ArchiveDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ready'; readonly archive: ArchiveDetail };
