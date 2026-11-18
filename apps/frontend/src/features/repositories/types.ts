export type RepositoryConnectionMode = 'NEW' | 'OWN';
export type RepositoryProvisionStatus =
  'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';
export type RepositoryInvitationStatus =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'
  | 'REVOKE_REQUIRED'
  | 'REVOKED'
  | 'REVOKE_FAILED_RETRYABLE'
  | 'REVOKE_FAILED_FINAL'
  | null;
export type RepositoryVisibility = 'PRIVATE' | 'PUBLIC';

export type MyRepositoryResponseItem = {
  readonly repositoryId: string | null;
  readonly teamId: string;
  readonly connectionMode: RepositoryConnectionMode;
  readonly programName: string;
  readonly displayName: string;
  readonly repositoryName: string | null;
  readonly githubUrl: string | null;
  readonly provisionStatus: RepositoryProvisionStatus;
  readonly invitationStatus: RepositoryInvitationStatus;
  readonly visibility: RepositoryVisibility | null;
};

export type MyRepositoriesResponse = {
  readonly items: readonly MyRepositoryResponseItem[];
};

export type MyRepositoryItem = MyRepositoryResponseItem & {
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
