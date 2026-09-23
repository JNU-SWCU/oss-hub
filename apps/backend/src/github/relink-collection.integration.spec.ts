import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  prisma,
  service,
  resolver,
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
  // Given: A is the active external target, with old facts, and is replaced by B.
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
  jest.spyOn(client, 'countDefaultBranchCommits').mockResolvedValue(null);
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
  // When: the next external sweep runs against the real database.
  const result = await sync.runExternal('synthetic-relink-collection');
  // Then: A is never fetched, its historical association/facts survive, and B receives new facts.
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

it('keeps independently discovered private or absent external repositories eligible for recovery', async () => {
  // Given: discovery tracks a repository independently of an application.
  await prisma.githubRepository.update({
    where: { id: targetId },
    data: { visibility: 'PRIVATE', presence: 'ABSENT' },
  });
  // When
  const selected = await collection.listExternalRepositories();
  // Then
  expect(selected).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: targetId })]),
  );
});

it('does not revive detached application tracking when discovery observes the same repository again', async () => {
  // Given: the external application target has been replaced.
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
  await service.updateMine(githubId, programId, input);
  // When: public discovery observes the historical identity again.
  await collection.enrollExternalRepository({
    githubRepositoryId: targetGithubId + 1n,
    nameWithOwner: 'synthetic/old',
    defaultBranch: 'main',
    archived: false,
    observedAt,
  });
  // Then
  expect(
    (await collection.listExternalRepositories()).some(
      (row) => row.id === oldId,
    ),
  ).toBe(false);
});

it('selects a historical external repository again when the application reattaches it', async () => {
  // Given: A was detached in favor of B.
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
  // When: the same application switches back to A.
  await service.updateMine(githubId, programId, {
    ...input,
    repositoryUrl: 'https://github.com/synthetic/old',
  });
  // Then
  const selected = await collection.listExternalRepositories();
  expect(selected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: oldId, applicationId }),
    ]),
  );
  expect(selected.some((row) => row.id === targetId)).toBe(false);
});

it('keeps a detached organization repository in organization inventory', async () => {
  // Given: the original organization repository was replaced by an external repository.
  await prisma.githubRepository.update({
    where: { id: oldId },
    data: { githubOrganizationId: 8133n, presence: 'PRESENT' },
  });
  await service.updateMine(githubId, programId, input);
  // When
  const selected = await collection.listPresentRepositories(8133n);
  // Then
  expect(selected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: oldId, applicationId: null }),
    ]),
  );
});

/** provider 없이 도는 합성 runtime — 저장소별 stream 호출을 셀 수 있게 전부 spy로 잡는다. */
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
    jest.spyOn(client, 'countDefaultBranchCommits').mockResolvedValue(null),
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
  ];
  const resolveUserNodeId = jest
    .spyOn(client, 'resolveUserNodeId')
    .mockResolvedValue('synthetic-node');
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
    /** stream 호출이 가리킨 저장소 이름(`owner/name`의 name) 목록. */
    streamedNames: () =>
      repositoryCalls.flatMap((spy) =>
        spy.mock.calls.map((call: readonly unknown[]) => call[1]),
      ),
  };
}

it('stops streaming a detached organization repository in the organization sweep', async () => {
  // Given: organization repository A was replaced by B, and C is an ordinary organization repository.
  await service.updateMine(githubId, programId, input);
  const organizationId = targetGithubId; // 이 케이스에만 쓰는 조직 id
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
  // When
  const result = await sync.run('synthetic-org-sweep');
  // Then: C is streamed as before; A is still observed but no longer streamed.
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
