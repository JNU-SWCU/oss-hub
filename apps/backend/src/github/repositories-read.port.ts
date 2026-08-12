export const REPOSITORIES_READ_PORT = Symbol('REPOSITORIES_READ_PORT');

export type RepositoryProvisionStatusDto =
  'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';

export type RepositoryInvitationStatusDto =
  'PENDING' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL' | null;

export interface OwnedRepositoryProjectionDto {
  readonly applicationId: string;
  readonly connectionMode: 'NEW' | 'OWN';
  readonly repositoryName: string | null;
  readonly githubUrl: string | null;
  readonly provisionStatus: RepositoryProvisionStatusDto;
  readonly invitationStatus: RepositoryInvitationStatusDto;
}

export interface RepositoriesReadPort {
  getMyRepositories(
    githubId: bigint,
  ): Promise<readonly OwnedRepositoryProjectionDto[]>;
}
