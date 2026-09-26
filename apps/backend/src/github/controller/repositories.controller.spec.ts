import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import { SessionGuard } from '../../auth/session.guard';
import { RepositoriesController } from './repositories.controller';
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
    const controller = new RepositoriesController(repositoriesService);

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
});
