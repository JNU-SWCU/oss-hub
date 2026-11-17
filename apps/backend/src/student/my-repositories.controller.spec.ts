import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import { MyRepositoriesController } from './my-repositories.controller';
import type { RepositoriesReadService } from '../github/repositories-read.service';

function handler(): (...args: unknown[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    MyRepositoriesController.prototype,
    'getMyRepositories',
  );
  const method: unknown = descriptor?.value;
  if (typeof method !== 'function') throw new Error('handler must exist');
  return method as (...args: unknown[]) => unknown;
}

describe('MyRepositoriesController', () => {
  it('passes the session github id to the service', async () => {
    const repositoriesService = {
      getMyRepositories: jest.fn().mockResolvedValue([
        {
          repositoryId: 'synthetic-repository',
          teamId: 'synthetic-application',
          applicationMode: 'PERSONAL' as const,
          programName: 'Synthetic program',
          displayName: 'Synthetic applicant',
          repositoryName: 'synthetic-repository',
          githubUrl: 'https://github.com/synthetic/synthetic-repository',
          provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
          invitationStatus: null,
          visibility: RepositoryVisibility.PRIVATE,
        },
      ]),
    } as jest.Mocked<Pick<RepositoriesReadService, 'getMyRepositories'>>;
    const controller = new MyRepositoriesController(repositoriesService);

    const response = await controller.getMyRepositories({
      sessionGithubId: 123n,
    });

    expect(repositoriesService.getMyRepositories).toHaveBeenCalledWith(123n);
    expect(response.items).toHaveLength(1);
  });

  it('leaves unauthenticated handling to the global authentication guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler())).toBeUndefined();
  });
});
