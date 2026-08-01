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
