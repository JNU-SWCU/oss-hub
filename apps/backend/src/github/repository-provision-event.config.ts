export type RepositoryProvisionConnectionMode = 'NEW' | 'OWN';

export interface RepositoryProvisionEventPayload {
  readonly applicationId: string;
  readonly programId: string;
  readonly teamId: string | null;
  readonly requestedAt: string;
  readonly collaboratorGithubLogins: readonly string[];

  readonly repositoryConnectionMode: RepositoryProvisionConnectionMode;
  readonly repositoryUrl: string | null;

  readonly requestedByGithubId?: string | null;
}

export interface RepositoryAccessSyncEventPayload {
  readonly applicationId: string;
  readonly teamId: string;
  readonly requestedAt: string;
}

export const REPOSITORY_PROVISION_EVENT_TYPE =
  'REPOSITORY_PROVISION_REQUESTED' as const;
