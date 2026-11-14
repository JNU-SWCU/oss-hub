import { RepoLedgerRepository } from '../platform/repo-ledger.repository';
import { seedRepos } from '../../test/repo-ledger.fixture';
import { Logger } from '@nestjs/common';
import { PlatformRepository } from '../platform/platform.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  SyntheticGithubProvider,
  createSyntheticSyncRuntime,
  SYNTHETIC_APP_ID,
  SYNTHETIC_ORG_LOGIN,
  type SyntheticRepositorySeed,
} from '../../test/collection-app.synthetic-provider';
import { PrismaService } from '../platform/prisma.service';
import {
  CollectionIncrementalRepository,
  type RepositorySource,
} from './collection-incremental.repository';
import { CollectionSyncService } from './collection-sync.service';
import { ProviderRequestQueueClient } from './provider-request-queue.client';
import { RepositoryUrlService } from './repository-url.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const APP_ID = BigInt(SYNTHETIC_APP_ID);
const ORG_LOGIN = SYNTHETIC_ORG_LOGIN;
const SCOPE = `org:${ORG_LOGIN}`;
const OWNER_ID = 'synthetic-scale-suite-instance';
const PROGRAM_PREFIX = 'synthetic-scale-program-';
const CONTRIBUTOR_PREFIX = 'synthetic-scale-contributor-';
const REPO_COUNT = 100;
const FIRST_REPO_ID = 9_000_000_100_000;
const BUSY_INDEX = 7;
const BUSY_PULL_REQUESTS = 150;
const HOUR = 3_600_000;
const SKEW_MS = 5 * 60_000;

const RUN_1 = new Date('2026-01-10T00:00:00.000Z');
const RUN_2 = new Date(RUN_1.getTime() + HOUR);
const RUN_3 = new Date(RUN_2.getTime() + HOUR);
const RUN_4 = new Date(RUN_3.getTime() + HOUR);

const contributorId = (n: number): number => 9_000_000_400 + (n % 5);
const at = (hoursBeforeRun1: number): string =>
  new Date(RUN_1.getTime() - hoursBeforeRun1 * HOUR).toISOString();

function buildSeeds(): SyntheticRepositorySeed[] {
  return Array.from({ length: REPO_COUNT }, (_, index) => {
    const id = FIRST_REPO_ID + index;
    const pullRequestCount = index === BUSY_INDEX ? BUSY_PULL_REQUESTS : 2;
    return {
      id,
      name: `repo-${index}`,
      owner: ORG_LOGIN,
      private: true,
      defaultBranch: index === 0 ? null : 'main',
      commits:
        index === 0
          ? []
          : [0, 1, 2].map((n) => ({
              sha: `synthetic-${index}-commit-${n}`,
              authorId: n === 2 ? null : contributorId(index + n),
              committedAt: at(1 + n + (index % 24)),
            })),
      pullRequests: Array.from({ length: pullRequestCount }, (_, n) => ({
        id: id * 1000 + n,
        createdAt: at(2 + (n % 100) + (index % 24)),
        authorId: contributorId(n),
      })),
      issues: [{ id: id * 1000 + 900, createdAt: at(30), authorId: null }],
      releases:
        index % 10 === 0
          ? [{ id: id * 1000 + 950, publishedAt: at(40), authorId: 1 }]
          : [],
    };
  });
}

const expectedContributionCount = (
  seeds: readonly SyntheticRepositorySeed[],
): number =>
  seeds.reduce(
    (sum, seed) =>
      sum +
      seed.commits.length +
      seed.pullRequests.length +
      seed.issues.length +
      seed.releases.length,
    0,
  );

class ScaleCollectionRepository extends CollectionIncrementalRepository {
  override async listCollectionTargets(source: RepositorySource) {
    return (await super.listCollectionTargets(source)).filter(
      (row) =>
        row.githubRepositoryId >= BigInt(FIRST_REPO_ID) &&
        row.githubRepositoryId < BigInt(FIRST_REPO_ID + REPO_COUNT),
    );
  }
}

describe('CollectionSyncService — 저장소 100개 probe/collect (실 DB)', () => {
  const prisma = new PrismaService();
  const repository = new ScaleCollectionRepository(
    prisma,
    new PlatformRepository(),
  );
  const seeds = buildSeeds();
  const repoIds = seeds.map((seed) => BigInt(seed.id));
  let clock = 2_000_000;
  const queue = new ProviderRequestQueueClient(
    () => clock,
    (ms) => {
      clock += ms;
      return Promise.resolve();
    },
  );
  const provider = new SyntheticGithubProvider(seeds, {
    rateRemaining: 1_000_000,
  });
  const runtime = createSyntheticSyncRuntime(provider, queue);
  let now = RUN_1;
  const service = new CollectionSyncService(
    repository,
    () => runtime,
    new RepositoryUrlService(),
    () => new Date(now),
  );
  let summaries: Record<string, unknown>[] = [];

  const contributionCount = (): Promise<number> =>
    prisma.contributionEvent.count({ where: { repoId: { in: repoIds } } });

  const lastSuccessAts = async (): Promise<Map<bigint, Date | null>> =>
    new Map(
      (
        await prisma.repo.findMany({
          where: { githubRepoId: { in: repoIds } },
          select: { githubRepoId: true, lastSuccessAt: true },
        })
      ).map((row) => [row.githubRepoId, row.lastSuccessAt]),
    );

  const runAt = async (
    runNow: Date,
    kind: 'hourly' | 'weekly' = 'hourly',
  ): Promise<Record<string, unknown>> => {
    now = runNow;
    provider.resetCounters();
    summaries = [];
    await expect(
      service.run(OWNER_ID, `run-${runNow.toISOString()}`, kind),
    ).resolves.toMatchObject({ status: 'COMPLETED', stoppedForBudget: false });
    const summary = summaries.at(-1);
    if (!summary) throw new Error('cycle summary was not logged');
    return summary;
  };

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation((entry: unknown) => {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { event?: unknown }).event === 'collection.cycle.summary'
      ) {
        summaries.push(entry as Record<string, unknown>);
      }
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await prisma.$connect();
    await prisma.user.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        id: `${CONTRIBUTOR_PREFIX}${index}`,
        githubId: BigInt(contributorId(index)),
        nickname: `synthetic-contributor-${index}`,
      })),
      skipDuplicates: true,
    });
    await prisma.program.createMany({
      data: seeds.map((seed) => ({
        id: `${PROGRAM_PREFIX}${seed.id}`,
        name: `Synthetic scale ${seed.id}`,
        organizer: 'Synthetic',
        category: 'BASIC',
        trackType: 'EXTRACURRICULAR',
        description: 'Synthetic',
        applicationTemplateKey: 'synthetic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2025-01-01T00:00:00Z'),
        applicationEndAt: new Date('2025-12-01T00:00:00Z'),
        startAt: new Date('2025-12-01T00:00:00Z'),
        endAt: new Date('2026-03-01T00:00:00Z'),
      })),
    });
    await prisma.team.createMany({
      data: seeds.map((seed) => ({
        id: `synthetic-scale-${seed.id}`,
        programId: `${PROGRAM_PREFIX}${seed.id}`,
        name: seed.name,
        leaderId: `${CONTRIBUTOR_PREFIX}0`,
        applicantId: `${CONTRIBUTOR_PREFIX}0`,
        answers: {},
        applicationTemplateVersion: 1,
      })),
    });
    await seedRepos(
      prisma,
      seeds.map((seed) => ({
        githubRepositoryId: BigInt(seed.id),
        teamId: `synthetic-scale-${seed.id}`,
        nameWithOwner: `${seed.owner}/${seed.name}`,
        defaultBranch: seed.defaultBranch,
        visibility: 'PRIVATE',
        source: 'ORG_PROVISIONED',
      })),
    );
  }, 60_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.collectionSyncLease.deleteMany({ where: { appId: APP_ID } });
    await prisma.contributionEvent.deleteMany({
      where: { repoId: { in: repoIds } },
    });
    await new RepoLedgerRepository().remove(prisma, repoIds);
    await prisma.team.deleteMany({
      where: { programId: { startsWith: PROGRAM_PREFIX } },
    });
    await prisma.program.deleteMany({
      where: { id: { startsWith: PROGRAM_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: CONTRIBUTOR_PREFIX } },
    });
    await prisma.$disconnect();
  });

  it('첫 실행은 probe 1번과 저장소당 수집 1번(100건 초과 저장소만 1번 더)으로 모든 기여를 한 번씩 넣는다', async () => {
    const summary = await runAt(RUN_1);

    expect(provider.counters.byKind).toEqual({
      probe: 1,
      collect: REPO_COUNT + 1,
      repository: 0,
    });
    expect(
      provider.counters.byRepository.get(`${ORG_LOGIN}/repo-${BUSY_INDEX}`),
    ).toEqual({ collect: 2 });
    await expect(contributionCount()).resolves.toBe(
      expectedContributionCount(seeds),
    );
    const successes = await lastSuccessAts();
    expect([...successes.values()]).toEqual(
      Array.from(
        { length: REPO_COUNT },
        () => new Date(RUN_1.getTime() - SKEW_MS),
      ),
    );
    expect(summary).toMatchObject({
      kind: 'hourly',
      repos: REPO_COUNT,
      probeRequests: 1,
      collectedRepos: REPO_COUNT,
      requests: REPO_COUNT + 2,
      inserted: expectedContributionCount(seeds),
    });
  });

  it('활동이 없는 다음 실행은 probe 1번만 보내고 원장에 쓰지 않으며 last_success_at만 올린다', async () => {
    const before = await contributionCount();

    const summary = await runAt(RUN_2);

    expect(provider.counters.byKind).toEqual({
      probe: 1,
      collect: 0,
      repository: 0,
    });
    await expect(contributionCount()).resolves.toBe(before);
    expect(
      new Set([...(await lastSuccessAts()).values()].map((d) => d?.getTime())),
    ).toEqual(new Set([RUN_2.getTime() - SKEW_MS]));
    expect(summary).toMatchObject({
      probeRequests: 1,
      collectedRepos: 0,
      requests: 1,
      inserted: 0,
    });
  });

  it('새 활동이 생긴 저장소 3개만 다시 수집하고 새 기여 3건만 넣는다', async () => {
    const before = await contributionCount();
    const changed = [3, 42, 99];
    for (const index of changed) {
      provider.mutate(ORG_LOGIN, `repo-${index}`, (repo) => {
        repo.commits.push({
          sha: `synthetic-${index}-commit-new`,
          authorId: contributorId(index),
          committedAt: new Date(RUN_2.getTime() + 10 * 60_000).toISOString(),
        });
      });
    }

    await runAt(RUN_3);

    expect(provider.counters.byKind).toEqual({
      probe: 1,
      collect: changed.length,
      repository: 0,
    });
    expect([...provider.counters.byRepository.keys()].sort()).toEqual(
      changed.map((index) => `${ORG_LOGIN}/repo-${index}`).sort(),
    );
    await expect(contributionCount()).resolves.toBe(before + changed.length);
  });

  it('주간 전체 재수집은 활동과 무관하게 모두 다시 읽고 중복 없이 0건을 넣는다', async () => {
    const before = await contributionCount();

    const summary = await runAt(RUN_4, 'weekly');

    expect(provider.counters.byKind).toEqual({
      probe: 1,
      collect: REPO_COUNT + 1,
      repository: 0,
    });
    await expect(contributionCount()).resolves.toBe(before);
    expect(summary).toMatchObject({
      kind: 'weekly',
      collectedRepos: REPO_COUNT,
      inserted: 0,
      fullScanFailedRepos: 0,
      truncatedRepos: 0,
    });
  });

  it('이름이 바뀐 저장소는 id로 다시 찾아 수집하고, 사라진 저장소는 gone 처리하고 나머지는 그대로 진행한다', async () => {
    provider.mutate(ORG_LOGIN, 'repo-10', (repo) => {
      repo.name = 'repo-10-renamed';
      repo.commits.push({
        sha: 'synthetic-10-commit-after-rename',
        authorId: contributorId(10),
        committedAt: new Date(RUN_4.getTime() + 10 * 60_000).toISOString(),
      });
    });
    provider.remove(ORG_LOGIN, 'repo-11');
    const runAfter = new Date(RUN_4.getTime() + HOUR);

    const summary = await runAt(runAfter);

    expect(provider.counters.byKind).toEqual({
      probe: 1,
      collect: 1,
      repository: 2,
    });
    await expect(
      prisma.repo.findUniqueOrThrow({
        where: { githubRepoId: BigInt(FIRST_REPO_ID + 10) },
        select: { ownerName: true },
      }),
    ).resolves.toEqual({ ownerName: `${ORG_LOGIN}/repo-10-renamed` });
    const gone = await prisma.repo.findUniqueOrThrow({
      where: { githubRepoId: BigInt(FIRST_REPO_ID + 11) },
      select: { goneAt: true, lastSuccessAt: true, ownerName: true },
    });
    expect(gone.goneAt).not.toBeNull();
    expect(gone.lastSuccessAt).toEqual(new Date(RUN_4.getTime() - SKEW_MS));
    const successes = await lastSuccessAts();
    expect(successes.get(BigInt(FIRST_REPO_ID + 10))).toEqual(
      new Date(runAfter.getTime() - SKEW_MS),
    );
    expect(successes.get(BigInt(FIRST_REPO_ID + 12))).toEqual(
      new Date(runAfter.getTime() - SKEW_MS),
    );
    expect(summary).toMatchObject({ collectedRepos: 1 });

    provider.resetCounters();
    now = new Date(runAfter.getTime() + HOUR);
    await service.run(OWNER_ID);
    expect(provider.counters.byKind).toEqual({
      probe: 1,
      collect: 0,
      repository: 0,
    });
  });

  it('빼앗긴 lease로 연 트랜잭션은 기여를 한 줄도 남기지 않는다', async () => {
    await prisma.collectionSyncLease.deleteMany({
      where: { appId: APP_ID, scope: SCOPE },
    });
    const leaseAt = new Date('2026-01-01T00:00:00.000Z');
    const stale = await repository.acquireSyncLease({
      appId: APP_ID,
      scope: SCOPE,
      ownerId: 'stale-owner',
      runId: 'stale-run',
      now: leaseAt,
      expiresAt: new Date(leaseAt.getTime() + 1_000),
    });
    if (!stale) throw new Error('expected to acquire the initial lease');
    const takeoverAt = new Date(leaseAt.getTime() + 2_000);
    const winner = await repository.acquireSyncLease({
      appId: APP_ID,
      scope: SCOPE,
      ownerId: 'winning-owner',
      runId: 'winning-run',
      now: takeoverAt,
      expiresAt: new Date(takeoverAt.getTime() + 60_000),
    });
    expect(winner?.epoch).toBe(stale.epoch + 1n);
    const row = await repository.findCollectionTargetByLogicalKey(
      BigInt(FIRST_REPO_ID + 20),
    );
    if (!row) throw new Error('fixture repository missing');
    const before = await contributionCount();

    await expect(
      repository.runInTransaction(async (repo) => {
        await repo.assertSyncLeaseValid(stale, takeoverAt);
        await repo.recordContributions(row.githubRepositoryId, 'commit', [
          {
            githubKey: 'synthetic-stale-lease-write-attempt',
            authorGithubId: null,
            occurredAt: takeoverAt,
          },
        ]);
      }),
    ).rejects.toThrow('lease is stale');

    await expect(contributionCount()).resolves.toBe(before);
    if (winner) {
      await repository.releaseSyncLease(
        winner,
        new Date(takeoverAt.getTime() + 1),
      );
    }
  });
});
