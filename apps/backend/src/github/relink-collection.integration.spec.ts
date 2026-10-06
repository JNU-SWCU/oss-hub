import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  prisma,
  service,
  resolver,
  collectionTrigger,
  githubId,
  programId,
  applicationId,
  teamId,
  oldId,
  targetId,
  targetGithubId,
  input,
} from '../applications/student-repository-url.integration.fixture';
import { CollectionAppClient } from './collection-app.client';
import { ProviderRequestQueue } from './collection-provider-queue';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { CollectionSyncService } from './service/collection-sync.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const collection = new CollectionIncrementalRepository(prisma);
class FixtureCollectionRepository extends CollectionIncrementalRepository {
  override async listExternalRepositories() {
    return (await super.listExternalRepositories()).filter(
      (row) => row.id === oldId || row.id === targetId,
    );
  }
}
const observedAt = new Date('2099-01-02T00:00:00Z');
const fingerprint = {
  endpoint: '/synthetic',
  ref: null,
  query: '',
  order: null,
  pageSize: 100,
  accept: 'application/vnd.github+json',
  apiVersion: '2022-11-28',
};

it('collects new facts only on the replacement when an external application repository is relinked', async () => {
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
  await service.updateMine(githubId, programId, input);
  const tokens = {
    getToken: () => Promise.resolve('synthetic-unused'),
    clear: jest.fn(),
  };
  const client = new CollectionAppClient(
    {
      appId: '8133',
      orgLogin: 'synthetic',
      privateKey: 'synthetic-unused',
      apiBaseUrl: 'https://example.invalid',
      maxPages: 1,
      deadlineMs: 1000,
    },
    tokens,
    () => Promise.reject(new Error('Unexpected provider request')),
  );
  const metadata = jest
    .spyOn(client, 'getRepository')
    .mockImplementation((owner, name) =>
      Promise.resolve({
        id: (name === 'old' ? targetGithubId + 1n : targetGithubId).toString(),
        name,
        fullName: `${owner}/${name}`,
        private: false,
        archived: false,
        defaultBranch: 'main',
        ownerLogin: owner,
        htmlUrl: `https://example.invalid/${owner}/${name}`,
        updatedAt: observedAt.toISOString(),
      }),
    );
  jest.spyOn(client, 'resolveUserNodeId').mockResolvedValue('synthetic-node');
  jest.spyOn(client, 'listDefaultBranchCommitsByAuthor').mockResolvedValue([
    {
      sha: 'new-after-relink',
      authorLogin: 'synthetic-relink-user',
      authorGithubId: githubId.toString(),
      committedAt: '2026-08-02T00:00:00Z',
      htmlUrl: 'https://example.invalid/commit/new-after-relink',
    },
  ]);
  jest
    .spyOn(client, 'countDefaultBranchCommitsBetween')
    .mockResolvedValue(null);
  jest.spyOn(client, 'listNewPullRequests').mockResolvedValue({
    pullRequests: [],
    newFrontier: null,
    fingerprint,
  });
  jest.spyOn(client, 'probeLatestRelease').mockResolvedValue({
    changed: true,
    frontier: null,
    fingerprint,
    etag: null,
  });
  jest
    .spyOn(client, 'listChangedPublishedReleases')
    .mockResolvedValue({ releases: [], fingerprint });
  jest
    .spyOn(client, 'listNewIssues')
    .mockResolvedValue({ issues: [], newFrontier: null, fingerprint });
  const runtime = () => ({
    appId: '8133',
    organizationLogin: 'synthetic',
    tokens,
    client,
    queue: new ProviderRequestQueue(),
  });
  const sync = new CollectionSyncService(
    new FixtureCollectionRepository(prisma),
    runtime,
    () => Promise.resolve(8133n),
    () => observedAt,
    () => 'synthetic-relink-collection-run',
    runtime,
  );

  const result = await sync.runExternal('synthetic-relink-collection');

  expect(result.status).toBe('COMPLETED');
  expect(metadata.mock.calls).toEqual([['synthetic', 'target']]);
  expect(
    await prisma.collectionCommitFact.findMany({
      where: { repositoryId: oldId },
    }),
  ).toEqual([]);
  expect(
    await prisma.collectionCommitFact.findMany({
      where: { repositoryId: targetId },
    }),
  ).toEqual([expect.objectContaining({ sha: 'new-after-relink' })]);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({
    applicationId: null,
    teamId,
    programId,
    source: 'EXTERNAL_PUBLIC',
  });
  expect(
    await prisma.contribution.findMany({ where: { repositoryId: oldId } }),
  ).toEqual([expect.objectContaining({ commitCount: 7 })]);
});

it('keeps a linked private or absent external repository eligible for recovery', async () => {
  await service.updateMine(githubId, programId, input);
  await prisma.githubRepository.update({
    where: { id: targetId },
    data: { visibility: 'PRIVATE', presence: 'ABSENT' },
  });

  const selected = await collection.listExternalRepositories();

  expect(selected).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: targetId })]),
  );
});

it('stops selecting a linked external repository once deletion clears every link', async () => {
  await service.updateMine(githubId, programId, input);
  await prisma.githubRepository.update({
    where: { id: targetId },
    data: { applicationId: null, programId: null, teamId: null },
  });

  const selected = await collection.listExternalRepositories();

  expect(selected.some((row) => row.id === targetId)).toBe(false);
});

it('does not revive a detached external repository when it is enrolled again', async () => {
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
  await service.updateMine(githubId, programId, input);

  await collection.enrollExternalRepository({
    githubRepositoryId: targetGithubId + 1n,
    nameWithOwner: 'synthetic/old',
    defaultBranch: 'main',
    archived: false,
    observedAt,
  });

  expect(
    (await collection.listExternalRepositories()).some(
      (row) => row.id === oldId,
    ),
  ).toBe(false);
});

it('selects a historical external repository again when the application reattaches it', async () => {
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
  await service.updateMine(githubId, programId, input);
  resolver.resolve.mockResolvedValue({
    kind: 'EXTERNAL',
    repository: {
      githubRepositoryId: targetGithubId + 1n,
      name: 'old',
      nameWithOwner: 'synthetic/old',
      url: 'https://github.com/synthetic/old',
      visibility: 'PUBLIC',
      description: null,
      defaultBranch: 'main',
      archived: false,
    },
  });

  await service.updateMine(githubId, programId, {
    ...input,
    repositoryUrl: 'https://github.com/synthetic/old',
  });

  const selected = await collection.listExternalRepositories();
  expect(selected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: oldId, applicationId }),
    ]),
  );
  expect(selected.some((row) => row.id === targetId)).toBe(false);
});

it('keeps a detached organization repository in organization inventory', async () => {
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { githubOrganizationId: 8133n, presence: 'PRESENT' },
  });
  await service.updateMine(githubId, programId, input);

  const selected = await collection.listPresentRepositories(8133n);

  expect(selected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: oldId, applicationId: null }),
    ]),
  );
});

function syntheticProvider() {
  const tokens = {
    getToken: () => Promise.resolve('synthetic-unused'),
    clear: jest.fn(),
  };
  const client = new CollectionAppClient(
    {
      appId: '8133',
      orgLogin: 'synthetic',
      privateKey: 'synthetic-unused',
      apiBaseUrl: 'https://example.invalid',
      maxPages: 1,
      deadlineMs: 1000,
    },
    tokens,
    () => Promise.reject(new Error('Unexpected provider request')),
  );
  const repositoryCalls = [
    jest.spyOn(client, 'probeDefaultBranchHead').mockResolvedValue({
      changed: false,
      fingerprint,
      etag: 'synthetic-etag',
    }),
    jest.spyOn(client, 'listCommitsUntilKnownSha').mockResolvedValue({
      commits: [],
      disconnectedFullScan: true,
      fingerprint,
    }),
    jest
      .spyOn(client, 'listDefaultBranchCommitsByAuthor')
      .mockResolvedValue([]),
    jest
      .spyOn(client, 'countDefaultBranchCommitsBetween')
      .mockResolvedValue(null),
    jest.spyOn(client, 'listNewPullRequests').mockResolvedValue({
      pullRequests: [],
      newFrontier: null,
      fingerprint,
    }),
    jest.spyOn(client, 'probeLatestRelease').mockResolvedValue({
      changed: false,
      fingerprint,
      etag: 'synthetic-etag',
    }),
    jest
      .spyOn(client, 'listNewIssues')
      .mockResolvedValue({ issues: [], newFrontier: null, fingerprint }),
  ];
  const resolveUserNodeId = jest
    .spyOn(client, 'resolveUserNodeId')
    .mockResolvedValue('synthetic-node');
  const getRepository = jest.spyOn(client, 'getRepository');
  const runtime = () => ({
    appId: '8133',
    organizationLogin: 'synthetic',
    tokens,
    client,
    queue: new ProviderRequestQueue(),
  });
  return {
    client,
    runtime,
    resolveUserNodeId,
    getRepository,

    streamedNames: () =>
      repositoryCalls.flatMap((spy) =>
        spy.mock.calls.map((call: readonly unknown[]) => call[1]),
      ),
  };
}

it('collects a repository linked into an empty slot right after the team route saves it', async () => {
  await prisma.githubRepository.delete({ where: { id: oldId } });
  const provider = syntheticProvider();
  jest
    .spyOn(provider.client, 'listDefaultBranchCommitsByAuthor')
    .mockResolvedValue([
      {
        sha: 'collected-right-after-link',
        authorLogin: 'synthetic-relink-user',
        authorGithubId: githubId.toString(),
        committedAt: '2026-08-02T00:00:00Z',
        htmlUrl: 'https://example.invalid/commit/collected-right-after-link',
      },
    ]);
  const sync = new CollectionSyncService(
    collection,
    provider.runtime,
    () => Promise.resolve(8133n),
    () => observedAt,
    () => 'synthetic-link-run',
    provider.runtime,
  );

  await service.updateForTeam(githubId, programId, teamId, input);
  const linked = collectionTrigger.collectRepository.mock.calls.map(
    ([id]) => id,
  );
  expect(linked).toEqual([targetGithubId]);
  const results = await Promise.all(
    linked.map((id) => sync.runRepository('synthetic-link', id)),
  );

  expect(results).toEqual([
    expect.objectContaining({
      status: 'COMPLETED',
      processedRepositoryCount: 1,
      insertedFactCount: 1,
    }),
  ]);
  expect(provider.getRepository).not.toHaveBeenCalled();
  expect(
    await prisma.collectionCommitFact.findMany({
      where: { repositoryId: targetId },
    }),
  ).toEqual([expect.objectContaining({ sha: 'collected-right-after-link' })]);
  expect(
    await prisma.contribution.findMany({ where: { repositoryId: targetId } }),
  ).toEqual([expect.objectContaining({ githubId, commitCount: 1 })]);
  expect(
    await prisma.githubRepository.findUnique({ where: { id: targetId } }),
  ).toMatchObject({ lastSuccessAt: observedAt, failureCount: 0 });
});

it('stops streaming a detached organization repository in the organization sweep', async () => {
  await service.updateMine(githubId, programId, input);
  const organizationId = targetGithubId;
  const listing = (id: bigint, name: string) => ({
    id: id.toString(),
    name,
    fullName: `synthetic/${name}`,
    private: true,
    archived: false,
    defaultBranch: 'main',
    ownerLogin: 'synthetic',
    htmlUrl: `https://example.invalid/synthetic/${name}`,
    updatedAt: observedAt.toISOString(),
  });
  const provider = syntheticProvider();
  jest
    .spyOn(provider.client, 'listInstallationRepositories')
    .mockResolvedValue([
      listing(targetGithubId + 1n, 'old'),
      listing(targetGithubId + 2n, 'normal'),
    ]);
  const sync = new CollectionSyncService(
    collection,
    provider.runtime,
    () => Promise.resolve(organizationId),
    () => observedAt,
    () => 'synthetic-org-sweep-run',
  );

  const result = await sync.run('synthetic-org-sweep');

  expect(result).toMatchObject({
    status: 'COMPLETED',
    inventoryComplete: true,
    processedRepositoryCount: 1,
  });
  expect(provider.streamedNames()).toContain('normal');
  expect(provider.streamedNames()).not.toContain('old');
  expect(provider.resolveUserNodeId).not.toHaveBeenCalled();
  expect(
    await prisma.githubRepository.findUnique({ where: { id: oldId } }),
  ).toMatchObject({
    presence: 'PRESENT',
    githubOrganizationId: organizationId,
    applicationId: null,
    teamId,
    programId,
    lastSuccessAt: null,
  });
  expect(
    await prisma.contribution.findMany({ where: { repositoryId: oldId } }),
  ).toEqual([expect.objectContaining({ commitCount: 7 })]);
});
