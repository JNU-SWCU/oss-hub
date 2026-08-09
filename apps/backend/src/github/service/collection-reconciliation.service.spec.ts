import {
  CollectionAppClient,
  CollectionAppClientError,
} from './collection-app.client';
import { CollectionAppConfigError } from './collection-app.config';
import {
  CollectionAppTokenError,
  CollectionAppTokenProvider,
} from './collection-app.token';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
import {
  CollectionReconciliationRuntime,
  CollectionReconciliationService,
} from './collection-reconciliation.service';
import { CollectionErrorCode } from './collection-error-code.enum';
import { DomainException } from '../common/error-code';

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};
type RepositoryMock = jest.Mocked<
  Pick<
    CollectionCanonicalRepository,
    | 'createCandidate'
    | 'appendPreflightFailure'
    | 'acquireLease'
    | 'heartbeatLease'
    | 'writeGeneration'
    | 'markValidity'
    | 'completeAndPublish'
    | 'finalizeFailure'
    | 'cleanupUnpublishedCandidate'
    | 'getStatusSnapshot'
  >
>;
type ClientMock = jest.Mocked<
  Pick<
    CollectionAppClient,
    | 'listInstallationRepositories'
    | 'getRepository'
    | 'listDefaultBranchCommits'
    | 'listPullRequests'
    | 'listPublishedReleases'
  >
>;

const fixture = (resourceFailure?: unknown) => {
  const lease = {
    appId: 1n,
    organizationLogin: 'org',
    ownerId: 'worker',
    epoch: 1n,
    runId: 'run-1',
    expiresAt: new Date('2026-01-01T00:10:00Z'),
  };
  const repository: RepositoryMock = {
    appendPreflightFailure: jest.fn().mockResolvedValue(undefined),
    createCandidate: jest.fn().mockResolvedValue(undefined),
    acquireLease: jest.fn().mockResolvedValue(lease),
    heartbeatLease: jest.fn().mockResolvedValue(undefined),
    writeGeneration: jest.fn().mockResolvedValue(undefined),
    markValidity: jest.fn().mockResolvedValue(undefined),
    completeAndPublish: jest.fn().mockResolvedValue(undefined),
    finalizeFailure: jest.fn().mockResolvedValue(undefined),
    cleanupUnpublishedCandidate: jest.fn().mockResolvedValue(true),
    getStatusSnapshot: jest.fn().mockResolvedValue({ runId: 'active-run' }),
  };
  const listed = {
    id: '10',
    name: 'repo',
    fullName: 'org/repo',
    private: false,
    archived: false,
    defaultBranch: 'main',
    ownerLogin: 'org',
    htmlUrl: 'https://example.invalid/repo',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const client: ClientMock = {
    listInstallationRepositories: jest.fn().mockResolvedValue([listed]),
    getRepository: jest.fn().mockResolvedValue(listed),
    listDefaultBranchCommits: jest.fn().mockResolvedValue([
      {
        sha: 'abc',
        authorGithubId: '20',
        authorLogin: 'alice',
        committedAt: '2026-01-01T00:00:00Z',
        htmlUrl: 'https://example.invalid/commit',
      },
    ]),
    listPullRequests: jest
      .fn()
      .mockRejectedValue(resourceFailure)
      .mockResolvedValueOnce([
        {
          id: '30',
          number: 1,
          state: 'closed',
          draft: false,
          mergedAt: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          authorGithubId: '20',
          authorLogin: 'alice',
          htmlUrl: 'https://example.invalid/pr',
        },
        {
          id: '31',
          number: 2,
          state: 'open',
          draft: false,
          mergedAt: null,
          createdAt: '2025-12-31T14:59:59Z',
          updatedAt: '2025-12-31T14:59:59Z',
          authorGithubId: null,
          authorLogin: null,
          htmlUrl: 'https://example.invalid/ghost-pr',
        },
      ]),
    listPublishedReleases: jest.fn().mockResolvedValue([
      {
        id: '40',
        tagName: 'v1',
        name: null,
        publishedAt: '2026-01-01T00:00:00Z',
        authorGithubId: null,
        authorLogin: null,
        htmlUrl: 'https://example.invalid/release',
      },
    ]),
  };
  if (resourceFailure)
    client.listPullRequests.mockReset().mockRejectedValue(resourceFailure);
  const tokens: jest.Mocked<
    Pick<CollectionAppTokenProvider, 'getInstallationIdentity' | 'getToken'>
  > = {
    getInstallationIdentity: jest.fn().mockResolvedValue({
      appId: '1',
      organizationId: '2',
    }),
    getToken: jest.fn().mockResolvedValue('installation-token'),
  };
  const runtime = {
    appId: '1',
    organizationLogin: 'org',
    tokens: tokens as unknown as CollectionAppTokenProvider,
    client: client as unknown as CollectionAppClient,
  } satisfies CollectionReconciliationRuntime;
  const service = new CollectionReconciliationService(
    repository as unknown as CollectionCanonicalRepository,
    () => runtime,
    () => new Date('2026-01-01T00:00:00Z'),
    () => 'run-1',
  );
  return { service, repository, client, tokens, listed };
};

describe('CollectionReconciliationService', () => {
  it('publishes one complete generation with bigint/date normalization and public-only attribution', async () => {
    const { service, repository } = fixture();
    await expect(service.trigger('worker')).resolves.toEqual({
      runId: 'run-1',
      status: 'PENDING',
    });
    await flush();
    expect(repository.writeGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({
        repositories: [expect.objectContaining({ githubRepositoryId: 10n })],
        contributors: [
          expect.objectContaining({
            githubUserId: 20n,
            commitCount: 1,
            pullRequestCount: 1,
            releaseCount: 0,
            currentYear: 2026,
            currentYearCommitCount: 1,
            currentYearPullRequestCount: 1,
            currentYearReleaseCount: 0,
          }),
        ],
      }),
      expect.any(Function),
    );
    const generation = repository.writeGeneration.mock.calls[0]?.[2];
    expect(generation?.commits).toEqual([
      expect.objectContaining({ authorGithubId: 20n }),
    ]);
    expect(generation?.commits[0]?.committedAt).toBeInstanceOf(Date);
    expect(generation?.pullRequests).toEqual([
      expect.objectContaining({
        githubPullRequestId: 30n,
        authorGithubId: 20n,
      }),
      expect.objectContaining({
        githubPullRequestId: 31n,
        authorGithubId: null,
        authorGithubLogin: null,
      }),
    ]);
    expect(generation?.releases).toEqual([
      expect.objectContaining({
        githubReleaseId: 40n,
        authorGithubId: null,
        authorGithubLogin: null,
      }),
    ]);
    expect(repository.completeAndPublish).toHaveBeenCalledTimes(1);
    expect(repository.heartbeatLease).toHaveBeenCalledTimes(1);
  });
  it('retains private canonical resources without creating public contributors', async () => {
    const { service, repository, client, listed } = fixture();
    const privateRepository = { ...listed, private: true };
    client.listInstallationRepositories.mockResolvedValue([privateRepository]);
    client.getRepository.mockResolvedValue(privateRepository);

    await service.trigger('worker');
    await flush();

    const generation = repository.writeGeneration.mock.calls[0]?.[2];
    expect(generation?.repositories).toEqual([
      expect.objectContaining({
        githubRepositoryId: 10n,
        visibility: 'private',
      }),
    ]);
    expect(generation?.commits).toHaveLength(1);
    expect(generation?.pullRequests).toHaveLength(2);
    expect(generation?.releases).toHaveLength(1);
    expect(generation?.contributors).toEqual([]);
  });

  it.each([
    [new CollectionAppClientError('PAGINATION'), 'INCOMPLETE', undefined],
    [new CollectionAppClientError('DEADLINE'), 'INCOMPLETE', undefined],
    [new CollectionAppClientError('AUTH'), 'INCOMPLETE', undefined],
    [
      new CollectionAppClientError('PERMISSION'),
      'INCOMPLETE',
      { installationValid: true, permissionsValid: false },
    ],
    [new CollectionAppClientError('RATE_LIMITED'), 'RATE_LIMITED', undefined],
    [new Error('safe failure'), 'FAILED', undefined],
  ] as const)(
    'preserves the prior generation and maps failures',
    async (error, status, validity) => {
      const { service, repository } = fixture(error);
      await service.trigger('worker');
      await flush();
      expect(repository.writeGeneration).not.toHaveBeenCalled();
      expect(repository.completeAndPublish).not.toHaveBeenCalled();
      expect(repository.finalizeFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Date),
        status,
        expect.any(String),
        validity,
      );
    },
  );
  it.each([
    ['AUTH', undefined],
    ['INSTALLATION', { installationValid: false, permissionsValid: false }],
    ['PERMISSIONS', { installationValid: true, permissionsValid: false }],
  ] as const)(
    'finalizes token issuance %s without publishing',
    async (reason, validity) => {
      const { service, repository, tokens } = fixture();
      tokens.getToken.mockRejectedValue(new CollectionAppTokenError(reason));

      await service.trigger('worker');
      await flush();

      expect(repository.markValidity).not.toHaveBeenCalled();
      expect(repository.completeAndPublish).not.toHaveBeenCalled();
      expect(repository.finalizeFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Date),
        'INCOMPLETE',
        `COLLECTION_APP_${reason}`,
        validity,
      );
    },
  );

  it.each([
    ['INSTALLATION', false, false],
    ['PERMISSIONS', true, false],
  ] as const)(
    'durably records %s preflight failure and updates validity without an active-generation write',
    async (reason, installationValid, permissionsValid) => {
      const { service, repository, tokens } = fixture();
      tokens.getInstallationIdentity.mockRejectedValue(
        new CollectionAppTokenError(reason),
      );

      await expect(service.trigger('worker')).rejects.toMatchObject({
        safeReason: reason,
      });
      const recorded = repository.appendPreflightFailure.mock.calls.at(0)?.[0];
      expect(recorded).toMatchObject({
        appId: 1n,
        organizationLogin: 'org',
        runId: 'run-1',
        errorClass: `COLLECTION_APP_${reason}`,
        validity: { installationValid, permissionsValid },
      });
      expect(recorded?.failedAt).toBeInstanceOf(Date);
      expect(repository.createCandidate).not.toHaveBeenCalled();
      expect(repository.completeAndPublish).not.toHaveBeenCalled();
    },
  );

  it.each(['UPSTREAM', 'RESPONSE'] as const)(
    'durably records safe %s preflight failure without invalidating installation or permissions',
    async (reason) => {
      const { service, repository, tokens } = fixture();
      tokens.getInstallationIdentity.mockRejectedValue(
        new CollectionAppTokenError(reason),
      );

      await expect(service.trigger('worker')).rejects.toMatchObject({
        safeReason: reason,
      });
      const recorded = repository.appendPreflightFailure.mock.calls.at(0)?.[0];
      expect(recorded).toMatchObject({
        appId: 1n,
        organizationLogin: 'org',
        runId: 'run-1',
        errorClass: `COLLECTION_APP_${reason}`,
        validity: undefined,
      });
      expect(recorded?.failedAt).toBeInstanceOf(Date);
      expect(Object.keys(recorded ?? {})).not.toContain('token');
      expect(repository.createCandidate).not.toHaveBeenCalled();
    },
  );
  it('cleans its losing candidate and returns only the active run conflict', async () => {
    const { service, repository } = fixture();
    repository.acquireLease.mockResolvedValue(null);
    await expect(service.trigger('worker')).rejects.toMatchObject({
      extensions: { activeRunId: 'active-run' },
    });
    expect(repository.cleanupUnpublishedCandidate).toHaveBeenCalledWith(
      'run-1',
    );
    expect(repository.writeGeneration).not.toHaveBeenCalled();
  });

  it('maps missing Collection App config to COL_007 without starting a run', async () => {
    const repository = {
      createCandidate: jest.fn(),
      appendPreflightFailure: jest.fn(),
      acquireLease: jest.fn(),
      heartbeatLease: jest.fn(),
      writeGeneration: jest.fn(),
      markValidity: jest.fn(),
      completeAndPublish: jest.fn(),
      finalizeFailure: jest.fn(),
      cleanupUnpublishedCandidate: jest.fn(),
      getStatusSnapshot: jest.fn(),
    } as RepositoryMock;
    const service = new CollectionReconciliationService(
      repository as unknown as CollectionCanonicalRepository,
      () => {
        throw new CollectionAppConfigError('GITHUB_COLLECTION_APP_ID');
      },
      () => new Date('2026-07-26T00:00:00.000Z'),
      () => 'run-1',
    );

    await expect(service.trigger('worker')).rejects.toBeInstanceOf(
      DomainException,
    );
    await expect(service.trigger('worker')).rejects.toMatchObject({
      errorCode: { code: CollectionErrorCode.COLLECTION_APP_UNAVAILABLE },
    });
    expect(repository.createCandidate).not.toHaveBeenCalled();
    expect(repository.appendPreflightFailure).not.toHaveBeenCalled();
  });

  it('uses only canonical repository writes', async () => {
    const { service, repository } = fixture();
    await service.trigger('worker');
    await flush();
    expect(
      Object.keys(repository).some((name) => /raw|legacy|oauth/i.test(name)),
    ).toBe(false);
  });
});
