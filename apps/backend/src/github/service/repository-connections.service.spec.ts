import { RepositoryConnectionMode, RepositorySource } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import type { GithubAppClient } from '../github-app.client';
import { RepositoryConnectionsErrorCode } from '../repository-connections-error-code';
import {
  RepositoryConnectionIdentityError,
  type RepositoryConnectionsRepository,
} from '../repository/repository-connections.repository';
import { GithubRepositoryClaimConflictError } from '../repository-provision-state.helpers';
import type { RepositoryOwnEnrollmentService } from './repository-own-enrollment.service';
import { RepositoryConnectionsService } from './repository-connections.service';

const NOW = new Date('2026-07-22T00:00:00.000Z');
const actor = { userId: 'actor', githubId: 1n, isStaff: false };
const metadata = {
  githubRepositoryId: 123n,
  name: 'repo',
  nameWithOwner: 'student/repo',
  url: 'https://github.com/student/repo',
  visibility: 'PUBLIC' as const,
  archived: false,
  defaultBranch: 'main',
  description: null,
};

function dependencies() {
  const repository = {
    findActorAuthorityByGithubId: jest.fn().mockResolvedValue(actor),
    checkConnectionAccess: jest.fn().mockResolvedValue('AUTHORIZED'),
    changeConnection: jest.fn().mockResolvedValue({
      status: 'PENDING',
      applicationId: 'application',
      repositoryId: null,
      connectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
      applicantGithubId: 123n,
      changed: true,
    }),
  } as jest.Mocked<
    Pick<
      RepositoryConnectionsRepository,
      | 'findActorAuthorityByGithubId'
      | 'checkConnectionAccess'
      | 'changeConnection'
    >
  >;
  const github = {
    organization: 'synthetic-org',
    findRepository: jest.fn().mockResolvedValue(null),
    findPublicRepository: jest.fn().mockResolvedValue(metadata),
  } as jest.Mocked<
    Pick<
      GithubAppClient,
      'organization' | 'findRepository' | 'findPublicRepository'
    >
  >;
  const collectionEnrollment = {
    enrollExternalRepository: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<
    Pick<RepositoryOwnEnrollmentService, 'enrollExternalRepository'>
  >;
  return { repository, github, collectionEnrollment };
}

function serviceFrom(deps: ReturnType<typeof dependencies>) {
  return new RepositoryConnectionsService(
    deps.repository,
    deps.github,
    deps.collectionEnrollment,
  );
}

async function expectCode(
  operation: Promise<unknown>,
  code: RepositoryConnectionsErrorCode,
) {
  try {
    await operation;
    throw new Error('Expected DomainException');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).errorCode.code).toBe(code);
  }
}

describe('RepositoryConnectionsService.changeConnection', () => {
  it.each(['missing', 'inactive'] as const)(
    'returns 403 for a %s actor',
    async () => {
      const deps = dependencies();
      deps.repository.findActorAuthorityByGithubId.mockResolvedValue(null);
      await expectCode(
        serviceFrom(deps).changeConnection(
          {
            applicationId: 'application',
            actorGithubId: 1n,
            mode: RepositoryConnectionMode.NEW,
            url: null,
          },
          NOW,
        ),
        RepositoryConnectionsErrorCode.FORBIDDEN,
      );
      expect(deps.repository.changeConnection).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['NOT_FOUND', RepositoryConnectionsErrorCode.NOT_FOUND],
    ['FORBIDDEN', RepositoryConnectionsErrorCode.FORBIDDEN],
  ] as const)(
    'rejects %s during the cheap authority preflight before GitHub resolution',
    async (access, code) => {
      const deps = dependencies();
      deps.repository.checkConnectionAccess.mockResolvedValue(access);
      await expectCode(
        serviceFrom(deps).changeConnection(
          {
            applicationId: 'application',
            actorGithubId: 1n,
            mode: RepositoryConnectionMode.OWN,
            url: metadata.url,
          },
          NOW,
        ),
        code,
      );
      expect(deps.github.findPublicRepository.mock.calls).toHaveLength(0);
      expect(deps.repository.changeConnection.mock.calls).toHaveLength(0);
    },
  );

  it.each([
    ['NOT_FOUND', RepositoryConnectionsErrorCode.NOT_FOUND],
    ['FORBIDDEN', RepositoryConnectionsErrorCode.FORBIDDEN],
    ['INVALID_STATE', RepositoryConnectionsErrorCode.INVALID_STATE],
  ] as const)('maps %s persistence result', async (status, code) => {
    const deps = dependencies();
    deps.repository.changeConnection.mockResolvedValue({ status });
    await expectCode(
      serviceFrom(deps).changeConnection(
        {
          applicationId: 'application',
          actorGithubId: 1n,
          mode: RepositoryConnectionMode.NEW,
          url: null,
        },
        NOW,
      ),
      code,
    );
  });

  it('resolves OWN and maps an external target source', async () => {
    const deps = dependencies();
    deps.repository.changeConnection.mockResolvedValue({
      status: 'CONNECTED',
      applicationId: 'application',
      repositoryId: 'repository',
      connectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: metadata.url,
      applicantGithubId: 999n,
      changed: true,
    });
    const service = serviceFrom(deps);
    await service.changeConnection(
      {
        applicationId: 'application',
        actorGithubId: 1n,
        mode: RepositoryConnectionMode.OWN,
        url: metadata.url,
      },
      NOW,
    );
    expect(deps.repository.changeConnection).toHaveBeenCalledWith(
      'application',
      actor,
      {
        mode: RepositoryConnectionMode.OWN,
        url: metadata.url,
        metadata,
        source: RepositorySource.EXTERNAL_PUBLIC,
        externalObservation: { defaultBranch: 'main', archived: false },
      },
      NOW,
    );
    expect(
      deps.collectionEnrollment.enrollExternalRepository,
    ).toHaveBeenCalledWith({
      applicantGithubId: 999n,
      githubRepositoryId: metadata.githubRepositoryId,
      nameWithOwner: metadata.nameWithOwner,
      defaultBranch: metadata.defaultBranch,
      archived: metadata.archived,
      observedAt: NOW,
    });
  });

  it('retries enrollment for an unchanged external OWN target', async () => {
    const deps = dependencies();
    deps.repository.changeConnection.mockResolvedValue({
      status: 'CONNECTED',
      applicationId: 'application',
      repositoryId: 'repository',
      connectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: metadata.url,
      applicantGithubId: 999n,
      changed: false,
    });
    await serviceFrom(deps).changeConnection(
      {
        applicationId: 'application',
        actorGithubId: 1n,
        mode: RepositoryConnectionMode.OWN,
        url: metadata.url,
      },
      NOW,
    );
    expect(
      deps.collectionEnrollment.enrollExternalRepository.mock.calls,
    ).toHaveLength(1);
  });

  it('maps an organization OWN target to ORG_PROVISIONED', async () => {
    const deps = dependencies();
    deps.github.findRepository.mockResolvedValue({
      ...metadata,
      visibility: 'PRIVATE',
    });
    await serviceFrom(deps).changeConnection(
      {
        applicationId: 'application',
        actorGithubId: 1n,
        mode: RepositoryConnectionMode.OWN,
        url: 'https://github.com/synthetic-org/repo',
      },
      NOW,
    );
    expect(deps.repository.changeConnection.mock.calls[0]?.[2]).toMatchObject({
      source: RepositorySource.ORG_PROVISIONED,
    });
  });

  it('uses the NEW branch without resolving GitHub', async () => {
    const deps = dependencies();
    await serviceFrom(deps).changeConnection(
      {
        applicationId: 'application',
        actorGithubId: 1n,
        mode: RepositoryConnectionMode.NEW,
        url: null,
      },
      NOW,
    );
    expect(deps.repository.changeConnection).toHaveBeenCalledWith(
      'application',
      actor,
      { mode: RepositoryConnectionMode.NEW },
      NOW,
    );
    expect(deps.github.findPublicRepository).not.toHaveBeenCalled();
  });

  it('maps repository claim conflicts to 409', async () => {
    const deps = dependencies();
    deps.repository.changeConnection.mockRejectedValue(
      new GithubRepositoryClaimConflictError(),
    );
    await expectCode(
      serviceFrom(deps).changeConnection(
        {
          applicationId: 'application',
          actorGithubId: 1n,
          mode: RepositoryConnectionMode.NEW,
          url: null,
        },
        NOW,
      ),
      RepositoryConnectionsErrorCode.CLAIM_CONFLICT,
    );
  });

  it('maps connection identity invariants to 422', async () => {
    const deps = dependencies();
    deps.repository.changeConnection.mockRejectedValue(
      new RepositoryConnectionIdentityError(),
    );
    await expectCode(
      serviceFrom(deps).changeConnection(
        {
          applicationId: 'application',
          actorGithubId: 1n,
          mode: RepositoryConnectionMode.NEW,
          url: null,
        },
        NOW,
      ),
      RepositoryConnectionsErrorCode.INVALID_TARGET,
    );
  });
});
