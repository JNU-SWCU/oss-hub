import { ApplicationStatus, RepositoryVisibility } from '@prisma/client';
import type { GithubAppClient } from '../src/repositories/github-app.client';
import type { RepositoryProvisionJobRepository } from '../src/repositories/repository-provision-job.repository';
import type {
  ProvisionedRepository,
  RepositoryProvisionContext,
  RepositoryProvisionStateStore,
} from '../src/repositories/repository-provision.contract';

export const PROVISION_NOW = new Date('2026-07-22T00:00:00.000Z');

export const PROVISION_REPOSITORY: ProvisionedRepository = {
  id: 'synthetic-repository-id',
  applicationId: 'synthetic-application-id',
  githubRepositoryId: 987654321n,
  name: 'synthetic-program-synthetic-student',
  url: 'https://github.com/synthetic-org/synthetic-program-synthetic-student',
  visibility: RepositoryVisibility.PRIVATE,
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

export function jobRepositoryMock(): jest.Mocked<
  Pick<RepositoryProvisionJobRepository, 'claimNext'>
> {
  return {
    claimNext: jest.fn().mockResolvedValue({
      id: 'synthetic-job-id',
      applicationId: 'synthetic-application-id',
      repositoryId: null,
      attemptCount: 1,
    }),
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
    'findRepository' | 'createRepository' | 'ensureCollaborator'
  >
> {
  return {
    findRepository: jest.fn().mockResolvedValue(null),
    createRepository: jest.fn().mockResolvedValue({
      githubRepositoryId: PROVISION_REPOSITORY.githubRepositoryId,
      name: PROVISION_REPOSITORY.name,
      url: PROVISION_REPOSITORY.url,
      visibility: PROVISION_REPOSITORY.visibility,
    }),
    ensureCollaborator: jest.fn().mockResolvedValue('SUCCEEDED'),
  };
}
