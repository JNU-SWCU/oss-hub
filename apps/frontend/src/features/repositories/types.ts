export type RepositoryApplicationMode = 'PERSONAL' | 'TEAM';
export type RepositoryProvisionStatus =
  'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';
export type RepositoryInvitationStatus =
  'PENDING' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL' | null;
export type RepositoryVisibility = 'PRIVATE' | 'PUBLIC';

export type MyRepositoryResponseItem = {
  readonly repositoryId: string;
  readonly applicationId: string;
  readonly applicationMode: RepositoryApplicationMode;
  readonly programName: string;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string | null;
  readonly provisionStatus: RepositoryProvisionStatus;
  readonly invitationStatus: RepositoryInvitationStatus;
  readonly visibility: RepositoryVisibility;
  readonly lastErrorCode: string | null;
  readonly updatedAt: string;
};

export type MyRepositoriesResponse = {
  readonly items: readonly MyRepositoryResponseItem[];
};

export type MyRepositoryItem = Omit<
  MyRepositoryResponseItem,
  'lastErrorCode'
> & {
  readonly modeLabel: string;
  readonly provisionLabel: string;
  readonly invitationLabel: string | null;
  readonly canOpenGithub: boolean;
};

export type MyRepositories = {
  readonly items: readonly MyRepositoryItem[];
};

export type MyRepositoriesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly repositories: MyRepositories };
