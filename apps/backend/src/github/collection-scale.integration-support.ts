import { TEST_READ_LIMIT } from '../../test/test-read-limit.config';
import { seedRepos } from '../../test/repo-ledger.fixture';
import { randomUUID } from 'node:crypto';
import { PlatformRepository } from '../platform/platform.repository';
import {
  SyntheticGithubProvider,
  createSyntheticSyncRuntime,
  SYNTHETIC_APP_ID,
  SYNTHETIC_ORG_LOGIN,
  type SyntheticRepositorySeed,
} from '../../test/collection-app.synthetic-provider';
import { createOwnedIntegrationDatabase } from '../../test/owned-integration-database.fixture';
import {
  CollectionIncrementalRepository,
  type RepositorySource,
} from './collection-incremental.repository';
import { CollectionSyncService } from './collection-sync.service';
import { ProviderRequestQueueClient } from './provider-request-queue.client';
import { RepositoryUrlService } from './repository-url.service';

export const APP_ID = BigInt(SYNTHETIC_APP_ID);
export const ORG_LOGIN = SYNTHETIC_ORG_LOGIN;
export const SCOPE = `org:${ORG_LOGIN}`;
const OWNER_ID = 'synthetic-scale-suite-instance';
const PROGRAM_PREFIX = 'synthetic-scale-program-';
const CONTRIBUTOR_PREFIX = 'synthetic-scale-contributor-';
export const REPO_COUNT = 100;
export const FIRST_REPO_ID = 9_000_000_100_000;
export const BUSY_INDEX = 7;
const BUSY_PULL_REQUESTS = 150;
export const HOUR = 3_600_000;
export const SKEW_MS = 5 * 60_000;

export const RUN_1 = new Date('2026-01-10T00:00:00.000Z');
export const RUN_2 = new Date(RUN_1.getTime() + HOUR);
export const RUN_3 = new Date(RUN_2.getTime() + HOUR);
export const RUN_4 = new Date(RUN_3.getTime() + HOUR);

export const contributorId = (n: number): number => 9_000_000_400 + (n % 5);
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

export const expectedContributionCount = (
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

export async function createScaleCollectionFixture(
  summaries: Map<string, Record<string, unknown>>,
) {
  const database = await createOwnedIntegrationDatabase();
  const prisma = database.prisma;
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

  const contributionCount = (): Promise<number> =>
    prisma.contributionEvent.count({ where: { repoId: { in: repoIds } } });

  const lastSuccessAts = async (): Promise<Map<bigint, Date | null>> =>
    new Map(
      (
        await prisma.repo.findMany({
          take: TEST_READ_LIMIT,
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
    const runId = randomUUID();
    try {
      await expect(service.run(OWNER_ID, runId, kind)).resolves.toMatchObject({
        status: 'COMPLETED',
        stoppedForBudget: false,
      });
      const summary = summaries.get(runId);
      if (!summary) throw new Error('cycle summary was not logged');
      return summary;
    } finally {
      summaries.delete(runId);
    }
  };

  try {
    await prisma.$connect();
    await prisma.user.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        id: `${CONTRIBUTOR_PREFIX}${index}`,
        githubId: BigInt(contributorId(index)),
        nickname: `synthetic-contributor-${index}`,
      })),
    });
    await prisma.program.createMany({
      data: seeds.map((seed) => ({
        id: `${PROGRAM_PREFIX}${seed.id}`,
        name: `Synthetic scale ${seed.id}`,
        organizers: ['Synthetic'],
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
  } catch (error) {
    await database.close();
    throw error;
  }

  return {
    prisma,
    repository,
    seeds,
    provider,
    runAt,
    contributionCount,
    lastSuccessAts,
    async close() {
      await database.close();
    },
  };
}
