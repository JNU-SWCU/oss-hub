import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import { SessionGuard } from '../../auth/session.guard';
import { RepositoriesController } from './repositories.controller';
import type { RepositoryConnectionsService } from '../service/repository-connections.service';
import type { RepositoriesService } from '../service/repositories.service';

const UPDATED_AT = new Date('2026-07-22T00:00:00.000Z');

function handler(): (...args: unknown[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    RepositoriesController.prototype,
    'getMyRepositories',
  );
  const method: unknown = descriptor?.value;
  if (typeof method !== 'function') throw new Error('handler must exist');
  return method as (...args: unknown[]) => unknown;
}

describe('RepositoriesController', () => {
  it('passes the session github id to the service and serializes timestamps', async () => {
    const repositoriesService = {
      getMyRepositories: jest.fn().mockResolvedValue([
        {
          repositoryId: 'synthetic-repository',
          applicationId: 'synthetic-application',
          applicationMode: 'PERSONAL' as const,
          programName: 'Synthetic program',
          displayName: 'Synthetic applicant',
          repositoryName: 'synthetic-repository',
          githubUrl: 'https://github.com/synthetic/synthetic-repository',
          provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
          invitationStatus: null,
          visibility: RepositoryVisibility.PRIVATE,
          lastErrorCode: null,
          updatedAt: UPDATED_AT,
        },
      ]),
    } as jest.Mocked<Pick<RepositoriesService, 'getMyRepositories'>>;
    const repositoryConnectionsService = {
      changeConnection: jest.fn(),
    } as jest.Mocked<Pick<RepositoryConnectionsService, 'changeConnection'>>;
    const controller = new RepositoriesController(
      repositoriesService,
      repositoryConnectionsService,
    );

    const response = await controller.getMyRepositories({
      sessionGithubId: 123n,
    });

    expect(repositoriesService.getMyRepositories).toHaveBeenCalledWith(123n);
    expect(response.items[0]?.updatedAt).toBe(UPDATED_AT.toISOString());
  });

  it('keeps unauthenticated handling with SessionGuard metadata', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler())).toEqual([
      SessionGuard,
    ]);
  });

  it('forwards PATCH connection changes and returns the connection response', async () => {
    const repositoriesService = {
      getMyRepositories: jest.fn(),
    } as jest.Mocked<Pick<RepositoriesService, 'getMyRepositories'>>;
    const repositoryConnectionsService = {
      changeConnection: jest.fn().mockResolvedValue({
        status: 'CONNECTED',
        applicationId: 'synthetic-application',
        repositoryId: 'synthetic-repository',
        connectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'https://github.com/synthetic/repository',
      }),
    } as jest.Mocked<Pick<RepositoryConnectionsService, 'changeConnection'>>;
    const controller = new RepositoriesController(
      repositoriesService,
      repositoryConnectionsService,
    );

    const response = await controller.changeConnection(
      { sessionGithubId: 123n },
      'synthetic-application',
      {
        mode: RepositoryConnectionMode.OWN,
        url: 'https://github.com/synthetic/repository',
      },
    );

    expect(repositoryConnectionsService.changeConnection).toHaveBeenCalledWith({
      applicationId: 'synthetic-application',
      actorGithubId: 123n,
      mode: RepositoryConnectionMode.OWN,
      url: 'https://github.com/synthetic/repository',
    });
    expect(response).toEqual({
      status: 'CONNECTED',
      applicationId: 'synthetic-application',
      repositoryId: 'synthetic-repository',
      connectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: 'https://github.com/synthetic/repository',
    });
  });
});
