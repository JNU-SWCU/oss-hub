export type PublicProfileApplicationMode = 'PERSONAL' | 'TEAM';

export type PublicProfileCategory =
  | 'BASIC'
  | 'SW_VALUE_SPREAD'
  | 'OSS_CONTEST'
  | 'CAPSTONE'
  | 'SW_CONVERGENCE'
  | 'GLOBAL_MAKERTHON'
  | 'CORPORATE_INTERNSHIP';

export type PublicProfileRepository = {
  readonly repositoryId: string;
  readonly programId: string;
  readonly programName: string;
  readonly category: PublicProfileCategory;
  readonly applicationMode: PublicProfileApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly detailUrl: string;
  readonly modeLabel: '개인' | '팀';
  readonly publishedLabel: string;
};

export type PublicProfile = {
  readonly userId: string;
  readonly githubNickname: string;
  readonly avatarUrl: string | null;
  readonly repositories: readonly PublicProfileRepository[];
};

export type PublicProfileState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ready'; readonly profile: PublicProfile };
