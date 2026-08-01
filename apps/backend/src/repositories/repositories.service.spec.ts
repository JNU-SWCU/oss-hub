import {
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { GithubAppClient } from './github-app.client';
import type {
  OwnedProvisionJob,
  RepositoriesRepository,
  RepositoriesTransactionStore,
} from './repositories.repository';
import {
  RepositoriesService,
  RepositoryNotFoundError,
  RepositoryProvisionStateError,
} from './repositories.service';

const NOW = new Date('2026-07-22T00:00:00.000Z');
const ACTOR_GITHUB_ID = 9_600_000_000_100_001n;
const target = {
  id: 'synthetic-repository-id',
  githubRepositoryId: 987654321n,
  name: 'synthetic-repository',
  url: 'https://github.com/synthetic-org/synthetic-repository',
  visibility: RepositoryVisibility.PRIVATE,
  publishedAt: null,
};

function dependencies() {
  const store = {
    auditLogWriter: {} as RepositoriesTransactionStore['auditLogWriter'],
    findPublishTarget: jest.fn().mockResolvedValue(target),
    publishRepositoryIfPrivate: jest.fn().mockResolvedValue(true),
  } as jest.Mocked<
    Pick<
      RepositoriesTransactionStore,
      'auditLogWriter' | 'findPublishTarget' | 'publishRepositoryIfPrivate'
    >
  >;
  const repository = {
    findPublishTarget: jest.fn().mockResolvedValue(target),
    listOwnedProvisionJobs: jest.fn().mockResolvedValue([]),
    withTransaction: jest.fn(
      async (
        operation: (store: RepositoriesTransactionStore) => Promise<unknown>,
      ) => operation(store as unknown as RepositoriesTransactionStore),
    ),
  } as jest.Mocked<
    Pick<
      RepositoriesRepository,
      'findPublishTarget' | 'listOwnedProvisionJobs' | 'withTransaction'
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
  const auditLog = {
    record: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<Pick<AuditLogService, 'record'>>;
  return { repository, github, auditLog, store };
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
    const { repository, github, auditLog } = dependencies();
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
    const service = new RepositoriesService(repository, github, auditLog);

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
    const { repository, github, auditLog } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({ status: RepositoryProvisionJobStatus.SUCCEEDED }),
    ]);

    await expect(
      new RepositoriesService(repository, github, auditLog).getMyRepositories(
        123n,
      ),
    ).rejects.toBeInstanceOf(RepositoryProvisionStateError);
  });

  it('fails closed when a succeeded job points at another application repository', async () => {
    const { repository, github, auditLog } = dependencies();
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
      new RepositoriesService(repository, github, auditLog).getMyRepositories(
        123n,
      ),
    ).rejects.toBeInstanceOf(RepositoryProvisionStateError);
  });

  it('fails closed when a pre-success job points at another application repository', async () => {
    const { repository, github, auditLog } = dependencies();
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
      new RepositoriesService(repository, github, auditLog).getMyRepositories(
        123n,
      ),
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
    const { repository, github, auditLog } = dependencies();
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
      new RepositoriesService(repository, github, auditLog).getMyRepositories(
        123n,
      ),
    ).rejects.toBeInstanceOf(RepositoryProvisionStateError);
  });
});

describe('RepositoriesService.publish', () => {
  it('이미 public인 repository는 GitHub를 다시 호출하지 않는다', async () => {
    const { repository, github, auditLog } = dependencies();
    repository.findPublishTarget.mockResolvedValue({
      ...target,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: NOW,
    });
    const service = new RepositoriesService(repository, github, auditLog);

    const result = await service.publish(
      { repositoryId: target.id },
      ACTOR_GITHUB_ID,
      NOW,
    );

    expect(result.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(github.publishRepository.mock.calls).toHaveLength(0);
    expect(repository.withTransaction.mock.calls).toHaveLength(0);
    expect(auditLog.record.mock.calls).toHaveLength(0);
  });

  it('GitHub 공개 결과의 identity를 확인한 뒤 승자가 정확히 1건의 typed audit을 남긴다', async () => {
    const { repository, github, auditLog, store } = dependencies();
    store.publishRepositoryIfPrivate.mockResolvedValue(true);
    const service = new RepositoriesService(repository, github, auditLog);

    const result = await service.publish(
      { repositoryId: target.id },
      ACTOR_GITHUB_ID,
      NOW,
    );

    expect(github.publishRepository.mock.calls).toEqual([[target.name]]);
    expect(store.publishRepositoryIfPrivate.mock.calls).toEqual([
      [target.id, target.githubRepositoryId, NOW],
    ]);
    expect(auditLog.record.mock.calls).toHaveLength(1);
    expect(auditLog.record.mock.calls[0]![0]).toMatchObject({
      actorGithubId: ACTOR_GITHUB_ID,
      action: 'REPOSITORY_PUBLISHED',
      targetType: 'REPOSITORY',
      targetId: target.id,
      metadata: {
        repositoryId: target.id,
        before: { visibility: RepositoryVisibility.PRIVATE },
        after: {
          visibility: RepositoryVisibility.PUBLIC,
          publishedAt: NOW.toISOString(),
        },
      },
    });
    expect(auditLog.record.mock.calls[0]![1]).toBe(store.auditLogWriter);
    expect(result).toMatchObject({
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: NOW,
    });
  });

  it('CAS에서 진 patron은 감사 기록 없이 승자가 커밋한 상태를 재조회한다', async () => {
    const { repository, github, auditLog, store } = dependencies();
    const winnerCommittedState = {
      ...target,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: NOW,
    };
    store.publishRepositoryIfPrivate.mockResolvedValue(false);
    store.findPublishTarget.mockResolvedValue(winnerCommittedState);
    const service = new RepositoriesService(repository, github, auditLog);

    const result = await service.publish(
      { repositoryId: target.id },
      ACTOR_GITHUB_ID,
      NOW,
    );

    expect(store.publishRepositoryIfPrivate.mock.calls).toEqual([
      [target.id, target.githubRepositoryId, NOW],
    ]);
    expect(auditLog.record.mock.calls).toHaveLength(0);
    expect(result).toEqual(winnerCommittedState);
  });

  it('없는 repository는 GitHub 호출 전에 중단한다', async () => {
    const { repository, github, auditLog } = dependencies();
    repository.findPublishTarget.mockResolvedValue(null);
    const service = new RepositoriesService(repository, github, auditLog);

    const publish = service.publish(
      { repositoryId: 'missing' },
      ACTOR_GITHUB_ID,
      NOW,
    );

    await expect(publish).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect(github.publishRepository.mock.calls).toHaveLength(0);
  });
});
