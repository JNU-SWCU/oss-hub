import {
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import type { GithubAppClient } from './github-app.client';
import type { ShowcaseProjectionService } from '../showcase/showcase-projection.service';
import type {
  OwnedProvisionJob,
  RepositoriesRepository,
} from './repositories.repository';
import {
  RepositoriesService,
  RepositoryNotFoundError,
  RepositoryProvisionStateError,
} from './repositories.service';

const NOW = new Date('2026-07-22T00:00:00.000Z');
const target = {
  id: 'synthetic-repository-id',
  githubRepositoryId: 987654321n,
  name: 'synthetic-repository',
  url: 'https://github.com/synthetic-org/synthetic-repository',
  visibility: RepositoryVisibility.PRIVATE,
  publishedAt: null,
};

function dependencies() {
  const repository = {
    findPublishTarget: jest.fn().mockResolvedValue(target),
    markPublished: jest.fn().mockResolvedValue(undefined),
    listOwnedProvisionJobs: jest.fn().mockResolvedValue([]),
  } as jest.Mocked<
    Pick<
      RepositoriesRepository,
      'findPublishTarget' | 'markPublished' | 'listOwnedProvisionJobs'
    >
  >;
  const github = {
    publishRepository: jest.fn().mockResolvedValue({
      githubRepositoryId: target.githubRepositoryId,
      name: target.name,
      url: target.url,
      visibility: RepositoryVisibility.PUBLIC,
      description: null,
    }),
  } as jest.Mocked<Pick<GithubAppClient, 'publishRepository'>>;
  return { repository, github };
}

function job(overrides: Partial<OwnedProvisionJob> = {}): OwnedProvisionJob {
  return {
    application: {
      id: 'synthetic-application',
      teamId: null,
      applicant: { nickname: 'synthetic-applicant' },
      program: { name: 'Synthetic program' },
      team: null,
    },
    status: RepositoryProvisionJobStatus.PENDING,
    lastErrorCode: null,
    updatedAt: NOW,
    repository: null,
    ...overrides,
  };
}

describe('RepositoriesService.getMyRepositories', () => {
  it('maps personal and team jobs into the safe response contract', async () => {
    const { repository, github } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        lastErrorCode: 'PROVISION_RETRYABLE',
        repository: {
          id: 'synthetic-in-progress-repository',
          applicationId: 'synthetic-application',
          name: 'synthetic-in-progress',
          url: 'https://github.com/synthetic-org/synthetic-in-progress',
          visibility: RepositoryVisibility.PRIVATE,
          invitations: [{ status: RepositoryInvitationStatus.PENDING }],
        },
      }),
      job({
        application: {
          id: 'synthetic-team-application',
          teamId: 'synthetic-team',
          applicant: { nickname: 'other-applicant' },
          program: { name: 'Team program' },
          team: { name: 'Synthetic team' },
        },
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        repository: {
          id: 'synthetic-completed-repository',
          applicationId: 'synthetic-team-application',
          name: 'synthetic-completed',
          url: 'https://github.com/JNU-SWCU/synthetic-completed',
          visibility: RepositoryVisibility.PRIVATE,
          invitations: [{ status: RepositoryInvitationStatus.SUCCEEDED }],
        },
      }),
    ]);
    const service = new RepositoriesService(repository, github);

    const result = await service.getMyRepositories(123n);

    expect(repository.listOwnedProvisionJobs).toHaveBeenCalledWith(123n);
    expect(result).toEqual([
      {
        repositoryId: null,
        applicationId: 'synthetic-application',
        applicationMode: 'PERSONAL',
        programName: 'Synthetic program',
        displayName: 'synthetic-applicant',
        repositoryName: null,
        githubUrl: null,
        provisionStatus: RepositoryProvisionJobStatus.PENDING,
        invitationStatus: null,
        visibility: null,
        lastErrorCode: 'PROVISION_RETRYABLE',
        updatedAt: NOW,
      },
      {
        repositoryId: 'synthetic-completed-repository',
        applicationId: 'synthetic-team-application',
        applicationMode: 'TEAM',
        programName: 'Team program',
        displayName: 'Synthetic team',
        repositoryName: 'synthetic-completed',
        githubUrl: 'https://github.com/JNU-SWCU/synthetic-completed',
        provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
        invitationStatus: RepositoryInvitationStatus.SUCCEEDED,
        visibility: RepositoryVisibility.PRIVATE,
        lastErrorCode: null,
        updatedAt: NOW,
      },
    ]);
  });

  it('fails closed when a succeeded job has no repository', async () => {
    const { repository, github } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({ status: RepositoryProvisionJobStatus.SUCCEEDED }),
    ]);

    await expect(
      new RepositoriesService(repository, github).getMyRepositories(123n),
    ).rejects.toBeInstanceOf(RepositoryProvisionStateError);
  });

  it('fails closed when a succeeded job points at another application repository', async () => {
    const { repository, github } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        repository: {
          id: 'synthetic-mismatched-repository',
          applicationId: 'another-application',
          name: 'synthetic-mismatched',
          url: 'https://github.com/synthetic-org/synthetic-mismatched',
          visibility: RepositoryVisibility.PRIVATE,
          invitations: [],
        },
      }),
    ]);

    await expect(
      new RepositoriesService(repository, github).getMyRepositories(123n),
    ).rejects.toBeInstanceOf(RepositoryProvisionStateError);
  });

  it('fails closed when a pre-success job points at another application repository', async () => {
    const { repository, github } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        status: RepositoryProvisionJobStatus.PROCESSING,
        repository: {
          id: 'synthetic-mismatched-repository',
          applicationId: 'another-application',
          name: 'synthetic-mismatched',
          url: 'https://github.com/JNU-SWCU/synthetic-mismatched',
          visibility: RepositoryVisibility.PRIVATE,
          invitations: [],
        },
      }),
    ]);

    await expect(
      new RepositoriesService(repository, github).getMyRepositories(123n),
    ).rejects.toBeInstanceOf(RepositoryProvisionStateError);
  });

  it.each([
    [
      'wrong organization',
      'synthetic-completed',
      'https://github.com/other-org/synthetic-completed',
    ],
    [
      'trailing path',
      'synthetic-completed',
      'https://github.com/JNU-SWCU/synthetic-completed/issues',
    ],
    [
      'unsafe repository name',
      'synthetic/completed',
      'https://github.com/JNU-SWCU/synthetic/completed',
    ],
  ])('fails closed on %s repository identity', async (_case, name, url) => {
    const { repository, github } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        repository: {
          id: 'synthetic-invalid-repository',
          applicationId: 'synthetic-application',
          name,
          url,
          visibility: RepositoryVisibility.PRIVATE,
          invitations: [],
        },
      }),
    ]);

    await expect(
      new RepositoriesService(repository, github).getMyRepositories(123n),
    ).rejects.toBeInstanceOf(RepositoryProvisionStateError);
  });
});

describe('RepositoriesService.publish', () => {
  it('이미 public인 repository는 GitHub를 다시 호출하지 않는다', async () => {
    const { repository, github } = dependencies();
    repository.findPublishTarget.mockResolvedValue({
      ...target,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: NOW,
    });
    const service = new RepositoriesService(repository, github);

    const result = await service.publish({ repositoryId: target.id }, NOW);

    expect(result.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(github.publishRepository.mock.calls).toHaveLength(0);
    expect(repository.markPublished.mock.calls).toHaveLength(0);
  });

  it('GitHub 공개 결과의 identity를 확인한 뒤 DB를 갱신한다', async () => {
    const { repository, github } = dependencies();
    const service = new RepositoriesService(repository, github);

    const result = await service.publish({ repositoryId: target.id }, NOW);

    expect(github.publishRepository.mock.calls).toEqual([[target.name]]);
    expect(repository.markPublished.mock.calls).toEqual([
      [target.id, target.githubRepositoryId, NOW],
    ]);
    expect(result).toMatchObject({
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: NOW,
    });
  });
  it('publishing projects only after the database publish succeeds and surfaces projection failures', async () => {
    const { repository, github } = dependencies();
    const showcase = {
      projectRepository: jest
        .fn()
        .mockRejectedValue(new Error('projection failed')),
    } as jest.Mocked<Pick<ShowcaseProjectionService, 'projectRepository'>>;
    const service = new RepositoriesService(repository, github, showcase);

    await expect(
      service.publish({ repositoryId: target.id }, NOW),
    ).rejects.toThrow('projection failed');
    expect(repository.markPublished.mock.calls).toEqual([
      [target.id, target.githubRepositoryId, NOW],
    ]);
    expect(showcase.projectRepository).toHaveBeenCalledWith(target.id, NOW);
  });

  it('없는 repository는 GitHub 호출 전에 중단한다', async () => {
    const { repository, github } = dependencies();
    repository.findPublishTarget.mockResolvedValue(null);
    const service = new RepositoriesService(repository, github);

    const publish = service.publish({ repositoryId: 'missing' }, NOW);

    await expect(publish).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect(github.publishRepository.mock.calls).toHaveLength(0);
  });
});
