import {
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  RepositorySource,
} from '@prisma/client';
import type { AuditLogService } from '../../audit-log/service/audit-log.service';
import type { GithubAppClient } from '../gateway/github-app.client';
import type {
  OwnedProvisionJob,
  RepositoriesRepository,
  RepositoriesTransactionStore,
} from '../repository/repositories.repository';
import {
  RepositoriesService,
  RepositoryNotFoundError,
} from './repositories.service';
import {
  RepositoriesReadService,
  RepositoryProvisionStateError,
} from './repositories-read.service';

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
  const organization = { requireOrganization: jest.fn(() => 'synthetic-org') };
  return { repository, github, auditLog, organization, store };
}

function serviceFrom(deps: ReturnType<typeof dependencies>) {
  return new RepositoriesService(deps.repository, deps.github, deps.auditLog);
}

function readServiceFrom(deps: ReturnType<typeof dependencies>) {
  return new RepositoriesReadService(deps.repository, deps.organization);
}

function job(
  overrides: Partial<Omit<OwnedProvisionJob, 'application'>> & {
    readonly application?: Partial<OwnedProvisionJob['application']>;
  } = {},
): OwnedProvisionJob {
  const { application, ...rest } = overrides;
  return {
    application: {
      id: 'synthetic-application',

      teamId: 'synthetic-solo-team',
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      applicant: { nickname: 'synthetic-applicant' },
      program: { name: 'Synthetic program' },

      team: { name: 'synthetic-applicant의 팀', _count: { members: 1 } },
      repository: null,
      ...application,
    },
    status: RepositoryProvisionJobStatus.PENDING,
    lastErrorCode: null,
    updatedAt: NOW,
    ...rest,
  };
}

describe('RepositoriesReadService.getMyRepositories', () => {
  it('returns an empty projection for an approved application with no provision job', async () => {
    const { repository, github, auditLog } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([]);

    await expect(
      readServiceFrom({
        ...dependencies(),
        repository,
        github,
        auditLog,
      }).getMyRepositories(123n),
    ).resolves.toEqual([]);
  });

  it('maps personal and team jobs into the safe response contract', async () => {
    const { repository, github, auditLog } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        lastErrorCode: 'PROVISION_RETRYABLE',
        application: {
          repository: {
            id: 'synthetic-in-progress-repository',
            name: 'synthetic-in-progress',
            url: 'https://github.com/synthetic-org/synthetic-in-progress',
            visibility: RepositoryVisibility.PRIVATE,
            source: RepositorySource.ORG_PROVISIONED,
            invitations: [{ status: RepositoryInvitationStatus.PENDING }],
          },
        },
      }),
      job({
        application: {
          id: 'synthetic-team-application',
          teamId: 'synthetic-team',
          repositoryConnectionMode: RepositoryConnectionMode.NEW,
          applicant: { nickname: 'other-applicant' },
          program: { name: 'Team program' },
          team: { name: 'Synthetic team', _count: { members: 2 } },
          repository: {
            id: 'synthetic-completed-repository',
            name: 'synthetic-completed',
            url: 'https://github.com/synthetic-org/synthetic-completed',
            visibility: RepositoryVisibility.PRIVATE,
            source: RepositorySource.ORG_PROVISIONED,
            invitations: [{ status: RepositoryInvitationStatus.SUCCEEDED }],
          },
        },
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      }),
    ]);
    const service = readServiceFrom({
      ...dependencies(),
      repository,
      github,
      auditLog,
    });

    const result = await service.getMyRepositories(123n);

    expect(repository.listOwnedProvisionJobs).toHaveBeenCalledWith(123n);
    expect(result).toEqual([
      {
        repositoryId: 'synthetic-in-progress-repository',
        applicationId: 'synthetic-application',
        connectionMode: RepositoryConnectionMode.NEW,
        applicationMode: 'PERSONAL',
        programName: 'Synthetic program',
        displayName: 'synthetic-applicant',
        repositoryName: 'synthetic-in-progress',
        githubUrl: 'https://github.com/synthetic-org/synthetic-in-progress',
        provisionStatus: RepositoryProvisionJobStatus.PENDING,
        invitationStatus: RepositoryInvitationStatus.PENDING,
        visibility: RepositoryVisibility.PRIVATE,
        lastErrorCode: 'PROVISION_RETRYABLE',
        updatedAt: NOW,
      },
      {
        repositoryId: 'synthetic-completed-repository',
        applicationId: 'synthetic-team-application',
        connectionMode: RepositoryConnectionMode.NEW,
        applicationMode: 'TEAM',
        programName: 'Team program',
        displayName: 'Synthetic team',
        repositoryName: 'synthetic-completed',
        githubUrl: 'https://github.com/synthetic-org/synthetic-completed',
        provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
        invitationStatus: RepositoryInvitationStatus.SUCCEEDED,
        visibility: RepositoryVisibility.PRIVATE,
        lastErrorCode: null,
        updatedAt: NOW,
      },
    ]);
  });

  it('returns OWN external URLs without throwing on the org identity invariant', async () => {
    const { repository, github, auditLog } = dependencies();
    const externalUrl =
      'https://github.com/synthetic-student/synthetic-own-repo';
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        application: {
          id: 'synthetic-own-application',

          teamId: 'synthetic-own-solo-team',
          repositoryConnectionMode: RepositoryConnectionMode.OWN,
          applicant: { nickname: 'synthetic-applicant' },
          program: { name: 'Synthetic program' },
          team: { name: 'synthetic-applicant의 팀', _count: { members: 1 } },
          repository: {
            id: 'synthetic-own-repository',
            name: 'synthetic-own-repo',
            url: externalUrl,
            visibility: RepositoryVisibility.PUBLIC,
            source: RepositorySource.EXTERNAL_PUBLIC,
            invitations: [],
          },
        },
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      }),
    ]);
    const service = readServiceFrom({
      ...dependencies(),
      repository,
      github,
      auditLog,
    });

    const result = await service.getMyRepositories(123n);

    expect(result).toEqual([
      {
        repositoryId: 'synthetic-own-repository',
        applicationId: 'synthetic-own-application',
        connectionMode: RepositoryConnectionMode.OWN,
        applicationMode: 'PERSONAL',
        programName: 'Synthetic program',
        displayName: 'synthetic-applicant',
        repositoryName: 'synthetic-own-repo',
        githubUrl: externalUrl,
        provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
        invitationStatus: null,
        visibility: RepositoryVisibility.PUBLIC,
        lastErrorCode: null,
        updatedAt: NOW,
      },
    ]);
  });

  it('keeps a persisted repository visible while an access reconciliation job is failing', async () => {
    const { repository, github, auditLog } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
        lastErrorCode: 'ACCESS_REVOKE_RETRYABLE',
        application: {
          repository: {
            id: 'synthetic-revoking-repository',
            name: 'synthetic-revoking',
            url: 'https://github.com/synthetic-org/synthetic-revoking',
            visibility: RepositoryVisibility.PRIVATE,
            source: RepositorySource.ORG_PROVISIONED,
            invitations: [
              { status: RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE },
            ],
          },
        },
      }),
    ]);

    const result = await readServiceFrom({
      ...dependencies(),
      repository,
      github,
      auditLog,
    }).getMyRepositories(123n);

    expect(result).toEqual([
      {
        repositoryId: 'synthetic-revoking-repository',
        applicationId: 'synthetic-application',
        connectionMode: RepositoryConnectionMode.NEW,
        applicationMode: 'PERSONAL',
        programName: 'Synthetic program',
        displayName: 'synthetic-applicant',
        repositoryName: 'synthetic-revoking',
        githubUrl: 'https://github.com/synthetic-org/synthetic-revoking',
        provisionStatus: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
        invitationStatus: RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE,
        visibility: RepositoryVisibility.PRIVATE,
        lastErrorCode: 'ACCESS_REVOKE_RETRYABLE',
        updatedAt: NOW,
      },
    ]);
  });

  it('reports the persisted invitation row instead of inferring revocation from job status', async () => {
    const { repository, github, auditLog } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        status: RepositoryProvisionJobStatus.PROCESSING,
        application: {
          repository: {
            id: 'synthetic-granted-repository',
            name: 'synthetic-granted',
            url: 'https://github.com/synthetic-org/synthetic-granted',
            visibility: RepositoryVisibility.PRIVATE,
            source: RepositorySource.ORG_PROVISIONED,
            invitations: [{ status: RepositoryInvitationStatus.SUCCEEDED }],
          },
        },
      }),
    ]);

    const result = await readServiceFrom({
      ...dependencies(),
      repository,
      github,
      auditLog,
    }).getMyRepositories(123n);

    expect(result[0]).toMatchObject({
      provisionStatus: RepositoryProvisionJobStatus.PROCESSING,
      invitationStatus: RepositoryInvitationStatus.SUCCEEDED,
    });
  });

  it('fails closed on invalid repository identity in a pre-success phase', async () => {
    const { repository, github, auditLog } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        status: RepositoryProvisionJobStatus.PROCESSING,
        application: {
          repository: {
            id: 'synthetic-invalid-repository',
            name: 'synthetic-invalid',
            url: 'https://github.com/other-org/synthetic-invalid',
            visibility: RepositoryVisibility.PRIVATE,
            source: RepositorySource.ORG_PROVISIONED,
            invitations: [],
          },
        },
      }),
    ]);

    await expect(
      readServiceFrom({
        ...dependencies(),
        repository,
        github,
        auditLog,
      }).getMyRepositories(123n),
    ).rejects.toBeInstanceOf(RepositoryProvisionStateError);
  });

  it('fails closed when a succeeded job has no repository', async () => {
    const { repository, github, auditLog } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({ status: RepositoryProvisionJobStatus.SUCCEEDED }),
    ]);

    await expect(
      readServiceFrom({
        ...dependencies(),
        repository,
        github,
        auditLog,
      }).getMyRepositories(123n),
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
      'https://github.com/synthetic-org/synthetic-completed/issues',
    ],
    [
      'unsafe repository name',
      'synthetic/completed',
      'https://github.com/synthetic-org/synthetic/completed',
    ],
  ])('fails closed on %s repository identity', async (_case, name, url) => {
    const { repository, github, auditLog } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        application: {
          repository: {
            id: 'synthetic-invalid-repository',
            name,
            url,
            visibility: RepositoryVisibility.PRIVATE,
            source: RepositorySource.ORG_PROVISIONED,
            invitations: [],
          },
        },
      }),
    ]);

    await expect(
      readServiceFrom({
        ...dependencies(),
        repository,
        github,
        auditLog,
      }).getMyRepositories(123n),
    ).rejects.toBeInstanceOf(RepositoryProvisionStateError);
  });
  it('classifies a direct link to an organization repository as OWN when the application records OWN', async () => {
    const { repository, github, auditLog } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        application: {
          id: 'synthetic-direct-link-application',
          teamId: 'synthetic-direct-link-team',
          repositoryConnectionMode: RepositoryConnectionMode.OWN,
          applicant: { nickname: 'synthetic-leader' },
          program: { name: 'Synthetic program' },
          team: { name: 'Synthetic direct team', _count: { members: 3 } },
          repository: {
            id: 'synthetic-direct-org-repository',
            name: 'synthetic-direct-org',
            url: 'https://github.com/synthetic-org/synthetic-direct-org',
            visibility: RepositoryVisibility.PUBLIC,
            source: RepositorySource.ORG_PROVISIONED,
            invitations: [],
          },
        },
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      }),
    ]);

    const [result] = await readServiceFrom({
      ...dependencies(),
      repository,
      github,
      auditLog,
    }).getMyRepositories(123n);

    expect(result).toMatchObject({
      repositoryId: 'synthetic-direct-org-repository',
      connectionMode: RepositoryConnectionMode.OWN,
      invitationStatus: null,
    });
  });
  it('classifies a valid external relink from persisted source on an immutable NEW application', async () => {
    const { repository, github, auditLog } = dependencies();
    const externalUrl =
      'https://github.com/synthetic-student/synthetic-relinked-repo';
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        application: {
          id: 'synthetic-application',
          teamId: 'synthetic-solo-team',
          repositoryConnectionMode: RepositoryConnectionMode.NEW,
          applicant: { nickname: 'synthetic-applicant' },
          program: { name: 'Synthetic program' },
          team: { name: 'synthetic-applicant의 팀', _count: { members: 1 } },
          repository: {
            id: 'synthetic-relinked-repository',
            name: 'synthetic-relinked-repo',
            url: externalUrl,
            visibility: RepositoryVisibility.PUBLIC,
            source: RepositorySource.EXTERNAL_PUBLIC,
            invitations: [],
          },
        },
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      }),
    ]);

    const result = await readServiceFrom({
      ...dependencies(),
      repository,
      github,
      auditLog,
    }).getMyRepositories(123n);

    expect(result).toEqual([
      {
        repositoryId: 'synthetic-relinked-repository',
        applicationId: 'synthetic-application',
        connectionMode: RepositoryConnectionMode.OWN,
        applicationMode: 'PERSONAL',
        programName: 'Synthetic program',
        displayName: 'synthetic-applicant',
        repositoryName: 'synthetic-relinked-repo',
        githubUrl: externalUrl,
        provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
        invitationStatus: null,
        visibility: RepositoryVisibility.PUBLIC,
        lastErrorCode: null,
        updatedAt: NOW,
      },
    ]);
  });

  it('fails closed when a managed identity does not match the persisted organization source', async () => {
    const { repository, github, auditLog } = dependencies();
    repository.listOwnedProvisionJobs.mockResolvedValue([
      job({
        application: {
          id: 'synthetic-application',
          teamId: 'synthetic-solo-team',
          repositoryConnectionMode: RepositoryConnectionMode.OWN,
          applicant: { nickname: 'synthetic-applicant' },
          program: { name: 'Synthetic program' },
          team: { name: 'synthetic-applicant의 팀', _count: { members: 1 } },
          repository: {
            id: 'synthetic-managed-mismatch-repository',
            name: 'synthetic-managed-mismatch',
            url: 'https://github.com/other-org/synthetic-managed-mismatch',
            visibility: RepositoryVisibility.PRIVATE,
            source: RepositorySource.ORG_PROVISIONED,
            invitations: [],
          },
        },
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      }),
    ]);

    await expect(
      readServiceFrom({
        ...dependencies(),
        repository,
        github,
        auditLog,
      }).getMyRepositories(123n),
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
    const service = serviceFrom({
      ...dependencies(),
      repository,
      github,
      auditLog,
    });

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
    const service = serviceFrom({
      ...dependencies(),
      repository,
      github,
      auditLog,
    });

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
    const service = serviceFrom({
      ...dependencies(),
      repository,
      github,
      auditLog,
    });

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
    const service = serviceFrom({
      ...dependencies(),
      repository,
      github,
      auditLog,
    });

    const publish = service.publish(
      { repositoryId: 'missing' },
      ACTOR_GITHUB_ID,
      NOW,
    );

    await expect(publish).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect(github.publishRepository.mock.calls).toHaveLength(0);
  });
});
