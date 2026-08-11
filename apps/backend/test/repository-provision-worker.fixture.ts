import { ApplicationStatus, RepositoryVisibility } from '@prisma/client';
import type { GithubAppClient } from '../src/github/github-app.client';
import type { RepositoryProvisionJobRepository } from '../src/github/repository/repository-provision-job.repository';
import type {
  ProvisionedRepository,
  RepositoryProvisionContext,
  RepositoryProvisionStateStore,
} from '../src/github/repository-provision.contract';
import { buildRepositoryOwnershipMarker } from '../src/github/repository-name';

export const PROVISION_NOW = new Date('2026-07-22T00:00:00.000Z');

export const PROVISION_REPOSITORY: ProvisionedRepository = {
  id: 'synthetic-repository-id',
  applicationId: 'synthetic-application-id',
  githubRepositoryId: 987654321n,
  name: 'synthetic-program-synthetic-student',
  url: 'https://github.com/synthetic-org/synthetic-program-synthetic-student',
  visibility: RepositoryVisibility.PRIVATE,
};

export const OWN_REPOSITORY_URL =
  'https://github.com/synthetic-student/synthetic-own-repo';

export const OWN_PROVISION_REPOSITORY: ProvisionedRepository = {
  id: 'synthetic-own-repository-id',
  applicationId: 'synthetic-application-id',
  githubRepositoryId: 1_111_222_333n,
  name: 'synthetic-own-repo',
  url: OWN_REPOSITORY_URL,
  visibility: RepositoryVisibility.PUBLIC,
};

export function provisionContext(
  overrides: Partial<RepositoryProvisionContext> = {},
): RepositoryProvisionContext {
  return {
    eventId: 'synthetic-event-id',
    eventPayload: {
      applicationId: 'synthetic-application-id',
      programId: 'synthetic-program-id',
      teamId: null,
      requestedAt: PROVISION_NOW.toISOString(),
      collaboratorGithubLogins: ['synthetic-leader', 'synthetic-student'],
    },
    applicationId: 'synthetic-application-id',
    applicantGithubId: 9_000_000_730_101n,
    applicationStatus: ApplicationStatus.APPROVED,
    programId: 'synthetic-program-id',
    programName: 'Synthetic Program',
    repositoryProvisioningEnabled: true,
    teamId: null,
    subjectName: 'Synthetic Student',
    repository: null,
    ...overrides,
  };
}

export function ownProvisionContext(
  overrides: Partial<RepositoryProvisionContext> = {},
): RepositoryProvisionContext {
  return provisionContext({
    eventPayload: {
      applicationId: 'synthetic-application-id',
      programId: 'synthetic-program-id',
      teamId: null,
      requestedAt: PROVISION_NOW.toISOString(),
      collaboratorGithubLogins: ['synthetic-leader', 'synthetic-student'],
      repositoryConnectionMode: 'OWN',
      repositoryUrl: OWN_REPOSITORY_URL,
    },
    ...overrides,
  });
}

export function jobRepositoryMock(): jest.Mocked<
  Pick<
    RepositoryProvisionJobRepository,
    'claimNext' | 'claimNextReconciliation' | 'renewLease'
  >
> {
  return {
    claimNext: jest.fn().mockResolvedValue({
      id: 'synthetic-job-id',
      applicationId: 'synthetic-application-id',
      repositoryId: null,
      attemptCount: 1,
    }),
    claimNextReconciliation: jest.fn().mockResolvedValue(null),
    renewLease: jest.fn().mockResolvedValue(undefined),
  };
}

export function provisionStateMock(): jest.Mocked<RepositoryProvisionStateStore> {
  return {
    loadContext: jest.fn().mockResolvedValue(provisionContext()),
    recordRepository: jest.fn().mockResolvedValue(PROVISION_REPOSITORY),
    prepareInvitations: jest.fn().mockResolvedValue(undefined),
    findInvitationWork: jest.fn().mockResolvedValue([
      { id: 'synthetic-invitation-leader', githubLogin: 'synthetic-leader' },
      { id: 'synthetic-invitation-student', githubLogin: 'synthetic-student' },
    ]),
    completeInvitation: jest.fn().mockResolvedValue(undefined),
    failInvitation: jest.fn().mockResolvedValue(undefined),
    completeJob: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
  };
}

export function githubClientMock(): jest.Mocked<
  Pick<
    GithubAppClient,
    | 'findRepository'
    | 'createRepository'
    | 'ensureCollaborator'
    | 'findPublicRepository'
    | 'organization'
  >
> {
  return {
    organization: 'synthetic-org',
    findRepository: jest.fn().mockResolvedValue(null),
    createRepository: jest.fn().mockResolvedValue({
      githubRepositoryId: PROVISION_REPOSITORY.githubRepositoryId,
      name: PROVISION_REPOSITORY.name,
      url: PROVISION_REPOSITORY.url,
      visibility: PROVISION_REPOSITORY.visibility,
      description: buildRepositoryOwnershipMarker('synthetic-application-id'),
    }),
    ensureCollaborator: jest.fn().mockResolvedValue('SUCCEEDED'),
    findPublicRepository: jest.fn().mockResolvedValue(null),
  };
}
