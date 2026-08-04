export type ArchiveApplicationMode = 'PERSONAL' | 'TEAM';

export const ARCHIVE_CATEGORY_LABELS = {
  BASIC: '기본 프로그램',
  SW_VALUE_SPREAD: 'SW 가치확산',
  OSS_CONTEST: 'OSS 경진대회',
  CAPSTONE: '캡스톤',
  SW_CONVERGENCE: 'SW 융합',
  GLOBAL_MAKERTHON: '글로벌 메이커톤',
  CORPORATE_INTERNSHIP: '기업 인턴십',
} as const;

export type ArchiveCategory = keyof typeof ARCHIVE_CATEGORY_LABELS;

export const ARCHIVE_CATEGORIES = Object.keys(
  ARCHIVE_CATEGORY_LABELS,
) as readonly ArchiveCategory[];

/** 사이드 패널·칩 공용. `all`은 쿼리 없이 `/archive`. */
export const ARCHIVE_LIST_FILTERS = ['all', ...ARCHIVE_CATEGORIES] as const;
export type ArchiveListFilter = (typeof ARCHIVE_LIST_FILTERS)[number];

export const ARCHIVE_LIST_FILTER_LABELS = {
  all: '전체',
  ...ARCHIVE_CATEGORY_LABELS,
} as const satisfies Readonly<Record<ArchiveListFilter, string>>;

export function archiveListHref(filter: ArchiveListFilter): string {
  if (filter === 'all') return '/archive';
  return `/archive?category=${filter}`;
}

export function parseArchiveListFilter(
  value: string | null,
): ArchiveListFilter {
  if (
    value !== null &&
    (ARCHIVE_LIST_FILTERS as readonly string[]).includes(value)
  ) {
    return value as ArchiveListFilter;
  }
  return 'all';
}

/** `GET /projects/category-counts` — 0 포함 전 키. */
export type ArchiveCategoryCounts = {
  readonly all: number;
} & Readonly<Record<ArchiveCategory, number>>;

export type ArchiveListItem = {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly category: ArchiveCategory;
  readonly applicationMode: ArchiveApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly detailUrl: string;
  readonly modeLabel: '개인' | '팀';
  readonly categoryLabel: string;
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
