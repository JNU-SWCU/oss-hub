import { PlatformRepository } from '../platform/platform.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  deleteRepos,
  repoWithTeam,
  seedRepo,
  unlinkRepo,
} from '../../test/repo-ledger.fixture';
import {
  repositoryContributionTotals,
  seedDailyContributions,
} from '../../test/ledger-contribution.fixture';
import {
  prisma,
  service,
  resolver,
  collectionTrigger,
  githubId,
  programId,
  teamId,
  oldGithubId,
  targetGithubId,
  input,
} from './student-repository-url.integration.fixture';
import type {
  CollectionAppClient,
  CollectionContribution,
  CollectionProbeResult,
  CollectionProbeTarget,
  CollectionRepositoryContributions,
} from '../github/collection-app.client';
import type { CollectionAppTokenClient } from '../github/collection-app-token.client';
import {
  CollectionIncrementalRepository,
  type RepositorySource,
} from '../github/collection-incremental.repository';
import { CollectionSyncService } from '../github/collection-sync.service';
import { ProviderRequestQueueClient } from '../github/provider-request-queue.client';
import { RepositoryUrlService } from '../github/repository-url.service';
import { SystemStatusRepository } from '../admin/system-status.repository';
import { RankingRepository } from '../ranking/ranking.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const collection = new CollectionIncrementalRepository(
  prisma,
  new PlatformRepository(),
);
class FixtureCollectionRepository extends CollectionIncrementalRepository {
  override async listCollectionTargets(source: RepositorySource) {
    return (await super.listCollectionTargets(source)).filter(
      (row) =>
        row.githubRepositoryId === targetGithubId + 1n ||
        row.githubRepositoryId === targetGithubId,
    );
  }
}
const observedAt = new Date('2099-01-02T00:00:00Z');

const commit = (githubKey: string): CollectionContribution => ({
  githubKey,
  authorGithubId: githubId.toString(),
  occurredAt: new Date('2098-12-30T00:00:00Z'),
});

const contributions = (
  commits: readonly CollectionContribution[],
): CollectionRepositoryContributions => ({
  contributions: { commit: commits, pull_request: [], issue: [], release: [] },
  requests: 1,
  pointsUsed: 1,
  rateLimit: null,
});

function syntheticProvider(commits: readonly CollectionContribution[] = []) {
  const client = {
    probeRepositories: jest.fn(
      (
        targets: readonly CollectionProbeTarget[],
      ): Promise<CollectionProbeResult> =>
        Promise.resolve({
          repositories: targets.map((target) => ({
            githubRepositoryId: (target.name === 'old'
              ? targetGithubId + 1n
              : targetGithubId
            ).toString(),
            nameWithOwner: `${target.owner}/${target.name}`,
            defaultBranch: 'main',
            archived: false,
            private: false,
            activityAt: [],
          })),
          rateLimit: null,
        }),
    ),
    getRepositoryById: jest.fn(),
    collectRepositoryContributions: jest.fn<
      Promise<CollectionRepositoryContributions>,
      [string, string, string | null, Date | null]
    >(() => Promise.resolve(contributions(commits))),
  };
  const runtime = () => ({
    appId: '8133',
    organizationLogin: 'synthetic',
    tokens: {} as CollectionAppTokenClient,
    client: client as unknown as CollectionAppClient,
    queue: new ProviderRequestQueueClient(),
  });
  return {
    client,
    runtime,
    collectedNames: () =>
      client.collectRepositoryContributions.mock.calls.map((call) => call[1]),
  };
}

it('collects new facts only on the replacement when an external application repository is relinked', async () => {
  await prisma.repo.upsert({
    where: { githubRepoId: targetGithubId },
    create: {
      githubRepoId: targetGithubId,
      ownerName: 'synthetic',
      source: 'EXTERNAL_PUBLIC',
    },
    update: {},
  });
  await prisma.repo.update({
    where: { githubRepoId: oldGithubId },
    data: { source: 'EXTERNAL_PUBLIC' },
  });
  await service.updateMine(githubId, programId, input);
  const provider = syntheticProvider([commit('new-after-relink')]);
  const sync = new CollectionSyncService(
    new FixtureCollectionRepository(prisma, new PlatformRepository()),
    provider.runtime,
    new RepositoryUrlService(),
    () => observedAt,
    () => 'synthetic-relink-collection-run',
    provider.runtime,
  );

  const result = await sync.runExternal('synthetic-relink-collection');

  expect(result.status).toBe('COMPLETED');
  expect(provider.client.probeRepositories.mock.calls).toEqual([
    [[{ owner: 'synthetic', name: 'target' }]],
  ]);
  expect(provider.collectedNames()).toEqual(['target']);
  expect(
    await prisma.contributionEvent.findMany({
      where: { repoId: targetGithubId, kind: 'COMMIT' },
    }),
  ).toEqual([expect.objectContaining({ githubKey: 'new-after-relink' })]);
  expect(await repoWithTeam(prisma, oldGithubId)).toBeNull();
  expect(
    (await repositoryContributionTotals(prisma, [oldGithubId])).commitCount,
  ).toBe(0);
});

it('비공개이거나 사라진 외부 저장소는 연결이 남아 있어도 수집 대상에서 빠진다', async () => {
  await service.updateMine(githubId, programId, input);
  await prisma.repo.update({
    where: { githubRepoId: targetGithubId },
    data: { visibility: 'PRIVATE', presence: 'ABSENT', goneAt: observedAt },
  });

  const selected = await collection.listCollectionTargets('EXTERNAL_PUBLIC');

  expect(
    selected.some((row) => row.githubRepositoryId === targetGithubId),
  ).toBe(false);
});

it('stops selecting a linked external repository once deletion clears every link', async () => {
  await service.updateMine(githubId, programId, input);
  await unlinkRepo(prisma, targetGithubId);

  const selected = await collection.listCollectionTargets('EXTERNAL_PUBLIC');

  expect(
    selected.some((row) => row.githubRepositoryId === targetGithubId),
  ).toBe(false);
});

it('does not revive a detached external repository when it is enrolled again', async () => {
  await prisma.repo.update({
    where: { githubRepoId: oldGithubId },
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
    (await collection.listCollectionTargets('EXTERNAL_PUBLIC')).some(
      (row) => row.githubRepositoryId === targetGithubId + 1n,
    ),
  ).toBe(false);
});

it('selects a historical external repository again when the application reattaches it', async () => {
  await prisma.repo.update({
    where: { githubRepoId: oldGithubId },
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

  const selected = await collection.listCollectionTargets('EXTERNAL_PUBLIC');
  expect(selected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        githubRepositoryId: targetGithubId + 1n,
        teamId,
      }),
    ]),
  );
  expect(
    selected.some((row) => row.githubRepositoryId === targetGithubId),
  ).toBe(false);
});

it('교체된 조직 저장소는 수집 목록에도 레포 테이블에도 남지 않는다', async () => {
  await service.updateMine(githubId, programId, input);
  const selected = await collection.listCollectionTargets('ORG_PROVISIONED');
  expect(
    selected.some((row) => row.githubRepositoryId === targetGithubId + 1n),
  ).toBe(false);
  expect(await repoWithTeam(prisma, oldGithubId)).toBeNull();
});

it.each(['ORG_PROVISIONED', 'EXTERNAL_PUBLIC'] as const)(
  'stops collecting and counting a deleted %s program repository while retaining facts and ranking',
  async (source) => {
    const repositoryName = `synthetic/${oldGithubId}`;
    await prisma.repo.update({
      where: { githubRepoId: oldGithubId },
      data: {
        ownerName: repositoryName,
        source,
        presence: 'PRESENT',
        visibility: 'PUBLIC',
        defaultBranch: 'main',
      },
    });
    await prisma.contributionEvent.deleteMany({
      where: { repoId: targetGithubId + 1n },
    });
    await seedDailyContributions(
      prisma,
      targetGithubId + 1n,
      [{ githubId, date: '2026-08-01', commitCount: 1 }],
      source,
    );
    await prisma.githubUserActivityObservation.upsert({
      where: {
        githubId_year_visibility_observedAt: {
          githubId,
          year: 2026,
          visibility: 'PUBLIC',
          observedAt,
        },
      },
      create: {
        githubId,
        year: 2026,
        visibility: 'PUBLIC',
        commitCount: 7,
        repositoryCount: 1,
        observedAt,
      },
      update: { commitCount: 7, repositoryCount: 1, observedAt },
    });
    const status = new SystemStatusRepository(prisma, new PlatformRepository());
    const ranking = new RankingRepository(prisma);
    const provider = syntheticProvider();
    const sync = new CollectionSyncService(
      collection,
      provider.runtime,
      new RepositoryUrlService(),
      () => observedAt,
      () => `synthetic-deleted-${source}`,
      provider.runtime,
    );
    const trackedCount = async (): Promise<number> =>
      source === 'ORG_PROVISIONED'
        ? (await status.getCollectionRepositories()).length
        : (await status.getExternalCollectionStatus()).trackedRepositoryCount;
    const beforeTracked = await trackedCount();
    expect(beforeTracked).toBeGreaterThan(0);
    if (source === 'ORG_PROVISIONED') {
      expect(await status.getCollectionRepositories()).toEqual(
        expect.arrayContaining([expect.objectContaining({ repositoryName })]),
      );
    } else {
      expect(await collection.listCollectionTargets('EXTERNAL_PUBLIC')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ githubRepositoryId: targetGithubId + 1n }),
        ]),
      );
    }
    const beforeRanking = await ranking.findMetrics({ currentYear: 2026 });
    expect(beforeRanking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ githubId, commitCount: 7 }),
      ]),
    );
    const beforeContributions = await repositoryContributionTotals(prisma, [
      oldGithubId,
    ]);
    expect(beforeContributions.commitCount).toBe(1);
    await prisma.program.update({
      where: { id: programId },
      data: { lifecycle: 'DELETED' },
    });

    expect(
      await sync.runRepository('synthetic-deleted', targetGithubId + 1n),
    ).toMatchObject({ status: 'SKIPPED', processedRepositoryCount: 0 });
    expect(provider.collectedNames()).toEqual([]);
    expect(provider.client.getRepositoryById).not.toHaveBeenCalled();
    await expect(
      seedRepo(prisma, {
        githubRepositoryId: targetGithubId + 2n,
        nameWithOwner: `synthetic/${oldGithubId}-duplicate`,
        teamId,
        source,
      }),
    ).rejects.toThrow('team_repo_team_id_period_excl');
    expect(await trackedCount()).toBe(beforeTracked - 1);
    if (source === 'ORG_PROVISIONED') {
      const repositories = await status.getCollectionRepositories();
      expect(
        repositories.some((row) => row.repositoryName === repositoryName),
      ).toBe(false);
    } else {
      expect(
        (await collection.listCollectionTargets('EXTERNAL_PUBLIC')).some(
          (row) => row.githubRepositoryId === targetGithubId + 1n,
        ),
      ).toBe(false);
    }
    expect(await repositoryContributionTotals(prisma, [oldGithubId])).toEqual(
      beforeContributions,
    );
    expect(await ranking.findMetrics({ currentYear: 2026 })).toEqual(
      beforeRanking,
    );
  },
);

it('collects a repository linked into an empty slot right after the team route saves it', async () => {
  await prisma.repo.upsert({
    where: { githubRepoId: targetGithubId },
    create: {
      githubRepoId: targetGithubId,
      ownerName: 'synthetic',
      source: 'EXTERNAL_PUBLIC',
    },
    update: {},
  });
  await deleteRepos(prisma, [oldGithubId]);
  const provider = syntheticProvider([commit('collected-right-after-link')]);
  const sync = new CollectionSyncService(
    collection,
    provider.runtime,
    new RepositoryUrlService(),
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
  expect(provider.client.probeRepositories).not.toHaveBeenCalled();
  expect(provider.client.collectRepositoryContributions).toHaveBeenCalledWith(
    'synthetic',
    'target',
    'main',
    new Date(observedAt.getTime() - 14 * 86_400_000),
  );
  expect(
    await prisma.contributionEvent.findMany({
      where: { repoId: targetGithubId, kind: 'COMMIT' },
    }),
  ).toEqual([
    expect.objectContaining({ githubKey: 'collected-right-after-link' }),
  ]);
  expect(
    await prisma.$queryRaw<{ commitCount: number }[]>`
      SELECT COUNT(*)::int AS "commitCount"
      FROM "contribution" AS event
      WHERE event.repo_id = ${targetGithubId}
        AND event.author_github_id = ${githubId}
        AND event.kind = 'commit'::"contribution_kind"
    `,
  ).toEqual([{ commitCount: 1 }]);
  expect(
    await prisma.repo.findUnique({
      where: { githubRepoId: targetGithubId },
      select: { lastSuccessAt: true },
    }),
  ).toEqual({ lastSuccessAt: new Date(observedAt.getTime() - 5 * 60_000) });
});

it('교체된 조직 저장소는 다음 조직 수집에서 되살아나지 않는다', async () => {
  await service.updateMine(githubId, programId, input);
  const provider = syntheticProvider();
  const sync = new CollectionSyncService(
    new FixtureCollectionRepository(prisma, new PlatformRepository()),
    provider.runtime,
    new RepositoryUrlService(),
    () => observedAt,
    () => 'synthetic-org-sweep-run',
  );
  const result = await sync.run('synthetic-org-sweep');
  expect(result).toMatchObject({
    status: 'COMPLETED',
    processedRepositoryCount: 0,
  });
  expect(provider.collectedNames()).toEqual([]);
  expect(await repoWithTeam(prisma, oldGithubId)).toBeNull();
  expect(
    (await repositoryContributionTotals(prisma, [oldGithubId])).commitCount,
  ).toBe(0);
});
