export type ArchiveApplicationMode = 'PERSONAL' | 'TEAM';

export type ArchiveCategory =
  | 'BASIC'
  | 'SW_VALUE_SPREAD'
  | 'OSS_CONTEST'
  | 'CAPSTONE'
  | 'SW_CONVERGENCE'
  | 'GLOBAL_MAKERTHON'
  | 'CORPORATE_INTERNSHIP';

export type ArchiveListItem = {
  readonly repositoryId: string;
  readonly programId: string;
  readonly programName: string;
  readonly category: ArchiveCategory;
  readonly applicationMode: ArchiveApplicationMode;
  readonly displayName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly detailUrl: string;
  readonly modeLabel: string;
  readonly publishedLabel: string;
};

export type ArchiveList = {
  readonly items: readonly ArchiveListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
};

export type ArchiveContributor = {
  readonly userId: string;
  readonly githubNickname: string;
  readonly avatarUrl: string | null;
};

export type ArchiveDetail = Omit<ArchiveListItem, 'detailUrl'> & {
  readonly repositoryName: string;
  readonly approvedSubmissionCount: number;
  readonly contributors: readonly ArchiveContributor[];
};

export type ArchiveListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly archive: ArchiveList };

export type ArchiveDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ready'; readonly archive: ArchiveDetail };
