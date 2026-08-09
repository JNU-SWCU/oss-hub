import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  SyntheticGithubProvider,
  syntheticPageCount,
  createSyntheticSyncRuntime,
  SYNTHETIC_APP_ID,
  SYNTHETIC_ORG_LOGIN,
  type SyntheticCommitSeed,
  type SyntheticPullRequestSeed,
  type SyntheticReleaseSeed,
  type SyntheticRepositorySeed,
} from '../../test/collection-app.synthetic-provider';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import {
  CollectionSyncService,
  type CollectionSyncRunResult,
} from './service/collection-sync.service';
import { ProviderRequestQueue } from './collection-provider-queue';

/**
 * public-admin-exposure todo 13 — 100-repository performance/idempotency
 * integration suite. Drives the REAL `CollectionSyncService` +
 * `CollectionAppClient` + `ProviderRequestQueue` + `CollectionIncrementalRepository`
 * stack against a real isolated Postgres and an HTTP-level synthetic GitHub
 * provider (no live GitHub call). Test-only: no production code is changed
 * by this suite; any defect found is reported in the final summary, not
 * fixed here.
 */

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

// Kept identical to the synthetic provider's own runtime identity (see
// `SYNTHETIC_APP_ID`/`SYNTHETIC_ORG_LOGIN`) so lease/cursor keys used directly
// by this suite never drift from what `CollectionSyncService.run()` actually
// writes through the runtime.
const APP_ID = BigInt(SYNTHETIC_APP_ID);
const ORG_LOGIN = SYNTHETIC_ORG_LOGIN;
// Matches `CollectionSyncService`'s private `orgScope()` convention — org
// sweep lease/cursor rows are keyed by `` `org:${organizationLogin}` ``, not
// by the bare login, since `scope` also has to make room for the external
// sweep's disjoint `"external"` key (GR-9).
const SCOPE = `org:${ORG_LOGIN}`;
const GITHUB_ORGANIZATION_ID = 9_000_000_300_002n;
const OWNER_ID = 'synthetic-scale-suite-instance';

const REPO_COUNT = 100;
const ANCHOR = Date.parse('2026-01-01T00:00:00.000Z');
const HOUR = 3_600_000;

const DISCONNECTED_NAME = 'repo-disconnected';
const RELEASE_CHANGED_NAME = 'repo-release-changed';
const NO_ETAG_NAME = 'repo-no-etag';
const PR_TIES_NAME = 'repo-pr-ties';
const DUPLICATE_COMMIT_NAME = 'repo-duplicate-commit';
const EMPTY_NAME = 'repo-empty';
const STABLE_CONTRAST_NAME = 'repo-16';

/** Deterministic fake clock (see `collection-provider-queue.spec.ts`): `sleep`
 * advances a mutable cursor instead of using real timers, so hundreds of
 * paced provider dispatches never cost real wall-clock time. */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
} {
  let cursor = 2_000_000;
  return {
    now: () => cursor,
    sleep: (ms: number) => {
      cursor += ms;
      return Promise.resolve();
    },
  };
}

function buildCommits(
  repoIndex: number,
  count: number,
  tag = '',
): SyntheticCommitSeed[] {
  return Array.from({ length: count }, (_, n) => ({
    sha: `synthetic-repo-${repoIndex}${tag}-commit-${n}`,
    authorId: 9_000_000_400 + (n % 5),
    authorLogin: `synthetic-contributor-${n % 5}`,
    committedAt: new Date(ANCHOR - (repoIndex * 1000 + n) * HOUR).toISOString(),
  }));
}

function buildPullRequests(
  repoIndex: number,
  count: number,
): SyntheticPullRequestSeed[] {
  return Array.from({ length: count }, (_, n) => ({
    id: 9_000_000_500_000 + repoIndex * 100 + n,
    createdAt: new Date(ANCHOR - (repoIndex * 1000 + n) * HOUR).toISOString(),
    state: n % 2 === 0 ? 'open' : ('closed' as const),
    authorId: 9_000_000_400 + (n % 5),
    authorLogin: `synthetic-contributor-${n % 5}`,
  }));
}

function buildReleases(
  repoIndex: number,
  count: number,
  tag = '',
): SyntheticReleaseSeed[] {
  return Array.from({ length: count }, (_, n) => ({
    id: 9_000_000_600_000 + repoIndex * 100 + n + (tag ? 50 : 0),
    publishedAt: new Date(ANCHOR - (repoIndex * 1000 + n) * HOUR).toISOString(),
    authorId: 9_000_000_400 + (n % 5),
    authorLogin: `synthetic-contributor-${n % 5}`,
  }));
}

/** Unique-by-key fact count a seed should ultimately produce — mirrors the
 * client's own `dedupeByKey`, so a fixture with an intentional duplicate
 * (see `repo-duplicate-commit`) is only counted once. */
function uniqueCommitCount(seed: SyntheticRepositorySeed): number {
  return new Set(seed.commits.map((c) => c.sha)).size;
}
function uniquePullRequestCount(seed: SyntheticRepositorySeed): number {
  return new Set(seed.pullRequests.map((pr) => pr.id)).size;
}
function uniqueReleaseCount(seed: SyntheticRepositorySeed): number {
  return new Set(seed.releases.map((r) => r.id)).size;
}

/** Exact first-ever-backfill request cost for one repository: the commit
 * stream skips its probe entirely on backfill (one paginated list only), the
 * PR stream always does exactly one paginated list, and the release stream
 * always probes once and (since there is no prior ETag yet) always follows
 * with one paginated list. */
function firstBackfillRequestCost(seed: SyntheticRepositorySeed): number {
  return (
    syntheticPageCount(seed.commits.length) +
    syntheticPageCount(seed.pullRequests.length) +
    1 +
    syntheticPageCount(seed.releases.length)
  );
}

function buildSeeds(): SyntheticRepositorySeed[] {
  const seeds: SyntheticRepositorySeed[] = [];
  for (let index = 0; index < REPO_COUNT; index += 1) {
    const id = 9_000_000_300 + index;
    const owner = ORG_LOGIN;
    const isPrivate = index >= 5 && index <= 14;

    if (index === 0) {
      seeds.push({
        id,
        name: DISCONNECTED_NAME,
        owner,
        private: false,
        defaultBranch: 'main',
        commits: buildCommits(index, 6),
        pullRequests: buildPullRequests(index, 2),
        releases: buildReleases(index, 1),
      });
      continue;
    }
    if (index === 1) {
      seeds.push({
        id,
        name: RELEASE_CHANGED_NAME,
        owner,
        private: false,
        defaultBranch: 'main',
        commits: buildCommits(index, 3),
        pullRequests: buildPullRequests(index, 1),
        releases: buildReleases(index, 1),
      });
      continue;
    }
    if (index === 2) {
      seeds.push({
        id,
        name: NO_ETAG_NAME,
        owner,
        private: false,
        defaultBranch: 'main',
        commits: buildCommits(index, 5),
        pullRequests: buildPullRequests(index, 1),
        releases: buildReleases(index, 1),
        noEtag: true,
      });
      continue;
    }
    if (index === 3) {
      const tiedCreatedAt = new Date(ANCHOR - 3_000 * HOUR).toISOString();
      seeds.push({
        id,
        name: PR_TIES_NAME,
        owner,
        private: false,
        defaultBranch: 'main',
        commits: buildCommits(index, 2),
        pullRequests: [
          {
            id: 9_000_000_500_900,
            createdAt: tiedCreatedAt,
            state: 'open',
            authorId: 9_000_000_401,
            authorLogin: 'synthetic-contributor-1',
          },
          {
            id: 9_000_000_500_901,
            createdAt: tiedCreatedAt,
            state: 'closed',
            authorId: 9_000_000_402,
            authorLogin: 'synthetic-contributor-2',
          },
        ],
        releases: [],
      });
      continue;
    }
    if (index === 4) {
      const dup: SyntheticCommitSeed = {
        sha: 'synthetic-repo-4-duplicate',
        authorId: 9_000_000_403,
        authorLogin: 'synthetic-contributor-3',
        committedAt: new Date(ANCHOR - 4_003 * HOUR).toISOString(),
      };
      seeds.push({
        id,
        name: DUPLICATE_COMMIT_NAME,
        owner,
        private: false,
        defaultBranch: 'main',
        // 6 commits at page size 4 = 2 pages; the duplicate sits at index 3
        // (last of page 1) AND index 4 (first of page 2) — an intentional
        // cross-page-boundary replay of the identical item.
        commits: [
          ...buildCommits(index, 3),
          dup,
          dup,
          {
            sha: 'synthetic-repo-4-commit-5',
            authorId: 9_000_000_404,
            authorLogin: 'synthetic-contributor-4',
            committedAt: new Date(ANCHOR - 4_005 * HOUR).toISOString(),
          },
        ],
        pullRequests: buildPullRequests(index, 1),
        releases: [],
      });
      continue;
    }
    if (index === 15) {
      seeds.push({
        id,
        name: EMPTY_NAME,
        owner,
        private: false,
        defaultBranch: 'main',
        commits: [],
        pullRequests: [],
        releases: [],
      });
      continue;
    }
    seeds.push({
      id,
      name: `repo-${index}`,
      owner,
      private: isPrivate,
      defaultBranch: 'main',
      commits: buildCommits(index, 1 + (index % 5)),
      pullRequests: buildPullRequests(index, index % 3),
      releases: buildReleases(index, index % 2),
    });
  }
  return seeds;
}

function repoKindSnapshot(
  provider: SyntheticGithubProvider,
  repoKey: string,
): Record<string, number> {
  return { ...(provider.counters.byRepositoryKind.get(repoKey) ?? {}) };
}
function kindDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(after)) {
    out[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return out;
}
function totalKindDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): number {
  return Object.values(kindDelta(before, after)).reduce((a, b) => a + b, 0);
}

describe('CollectionSyncService — 100-repository scale/idempotency suite (public-admin-exposure todo 13)', () => {
  const prisma = new PrismaService();
  const repository = new CollectionIncrementalRepository(prisma);
  const seeds = buildSeeds();
  const resolveGithubOrganizationId = () =>
    Promise.resolve(GITHUB_ORGANIZATION_ID);

  const clock = fakeClock();
  const queue = new ProviderRequestQueue(clock.now, clock.sleep);
  const provider = new SyntheticGithubProvider(seeds);
  const dispatchTimes: number[] = [];
  const runtime = createSyntheticSyncRuntime(provider, queue, (input, init) => {
    dispatchTimes.push(clock.now());
    return provider.fetcher(input, init);
  });
  const service = new CollectionSyncService(
    repository,
    () => runtime,
    resolveGithubOrganizationId,
  );

  const commitWrites: number[] = [];
  const pullRequestWrites: number[] = [];
  const releaseWrites: number[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    // Captured as unbound references deliberately: each is re-bound per call
    // via `.call(this, ...)` inside the mock below, since `this` varies (a
    // fresh `CollectionIncrementalRepository` per `runInTransaction` call).
    const originalCommit =
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CollectionIncrementalRepository.prototype.recordCommitFacts;
    const originalPullRequest =
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CollectionIncrementalRepository.prototype.recordPullRequestFacts;
    const originalRelease =
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CollectionIncrementalRepository.prototype.recordReleaseFacts;
    jest
      .spyOn(CollectionIncrementalRepository.prototype, 'recordCommitFacts')
      .mockImplementation(async function (
        this: CollectionIncrementalRepository,
        repositoryId,
        facts,
      ) {
        const result = await originalCommit.call(this, repositoryId, facts);
        commitWrites.push(result.insertedCount);
        return result;
      });
    jest
      .spyOn(
        CollectionIncrementalRepository.prototype,
        'recordPullRequestFacts',
      )
      .mockImplementation(async function (
        this: CollectionIncrementalRepository,
        repositoryId,
        facts,
      ) {
        const result = await originalPullRequest.call(
          this,
          repositoryId,
          facts,
        );
        pullRequestWrites.push(result.insertedCount);
        return result;
      });
    jest
      .spyOn(CollectionIncrementalRepository.prototype, 'recordReleaseFacts')
      .mockImplementation(async function (
        this: CollectionIncrementalRepository,
        repositoryId,
        facts,
      ) {
        const result = await originalRelease.call(this, repositoryId, facts);
        releaseWrites.push(result.insertedCount);
        return result;
      });
  }, 60_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionSyncLease" WHERE "appId" = $1',
      APP_ID,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionSyncCursor" WHERE "appId" = $1',
      APP_ID,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "GithubRepository" WHERE "githubOrganizationId" = $1',
      GITHUB_ORGANIZATION_ID,
    );
    await prisma.$disconnect();
  });

  /**
   * Forces exactly `reposPerRun` repositories to be processed per
   * `service.run()` call by making the shared queue's `shouldStop()` report
   * true right after that many repositories have been considered this run —
   * a deterministic stand-in for "GitHub installation rate-limit budget
   * exhausted partway through a run" that does not depend on hand-tuning the
   * real `x-ratelimit-*` arithmetic across a heterogeneous 100-repo fixture.
   */
  async function runWithBudget(
    reposPerRun: number,
  ): Promise<CollectionSyncRunResult> {
    let considered = 0;
    const spy = jest.spyOn(queue, 'shouldStop').mockImplementation(() => {
      considered += 1;
      return considered > reposPerRun;
    });
    try {
      return await service.run(OWNER_ID);
    } finally {
      spy.mockRestore();
    }
  }

  let initialDrainRuns: CollectionSyncRunResult[] = [];

  it('drains all 100 repositories exactly once across budget-limited runs, in fair ascending cursor order, with zero missing or duplicate facts and an exact deterministic request count', async () => {
    const cursorAdvances: bigint[] = [];
    // Rebound per call via `.call(this, ...)` below (see comment in `beforeAll`).
    const originalUpsertCursor =
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CollectionIncrementalRepository.prototype.upsertSyncCursor;
    jest
      .spyOn(CollectionIncrementalRepository.prototype, 'upsertSyncCursor')
      .mockImplementation(async function (
        this: CollectionIncrementalRepository,
        input,
      ) {
        if (typeof input.lastGithubRepositoryId === 'bigint') {
          cursorAdvances.push(input.lastGithubRepositoryId);
        }
        return originalUpsertCursor.call(this, input);
      });

    const reposPerRun = 15;
    const runs: CollectionSyncRunResult[] = [];
    for (let i = 0; i < 20; i += 1) {
      const result = await runWithBudget(reposPerRun);
      runs.push(result);
      if (result.cycleCompleted) break;
    }
    initialDrainRuns = runs;

    expect(runs[runs.length - 1]?.cycleCompleted).toBe(true);
    const expectedRunCount = Math.ceil(REPO_COUNT / reposPerRun);
    expect(runs).toHaveLength(expectedRunCount);
    expect(
      runs.reduce((sum, run) => sum + run.processedRepositoryCount, 0),
    ).toBe(REPO_COUNT);

    // Fair ascending cursor order: every repository advances the durable
    // cursor exactly once, strictly increasing — the cycle never restarts.
    expect(cursorAdvances).toHaveLength(REPO_COUNT);
    const sortedIds = [...seeds]
      .map((s) => BigInt(s.id))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(cursorAdvances).toEqual(sortedIds);

    // Zero missing/duplicate facts.
    const [commitCount, pullRequestCount, releaseCount] = await Promise.all([
      prisma.collectionCommitFact.count({
        where: { repository: { githubOrganizationId: GITHUB_ORGANIZATION_ID } },
      }),
      prisma.collectionPullRequestFact.count({
        where: { repository: { githubOrganizationId: GITHUB_ORGANIZATION_ID } },
      }),
      prisma.collectionReleaseFact.count({
        where: { repository: { githubOrganizationId: GITHUB_ORGANIZATION_ID } },
      }),
    ]);
    expect(commitCount).toBe(
      seeds.reduce((sum, s) => sum + uniqueCommitCount(s), 0),
    );
    expect(pullRequestCount).toBe(
      seeds.reduce((sum, s) => sum + uniquePullRequestCount(s), 0),
    );
    expect(releaseCount).toBe(
      seeds.reduce((sum, s) => sum + uniqueReleaseCount(s), 0),
    );

    // The duplicate-commit repo specifically dedupes its cross-page replay.
    const duplicateSeed = seeds.find((s) => s.name === DUPLICATE_COMMIT_NAME);
    if (!duplicateSeed)
      throw new Error('fixture missing duplicate-commit repo');
    expect(duplicateSeed.commits).toHaveLength(6);
    expect(uniqueCommitCount(duplicateSeed)).toBe(5);
    const duplicateRepoRow = await repository.findRepositoryByLogicalKey(
      BigInt(duplicateSeed.id),
    );
    if (!duplicateRepoRow) throw new Error('duplicate-commit repo not synced');
    expect(
      await prisma.collectionCommitFact.count({
        where: { repositoryId: duplicateRepoRow.id },
      }),
    ).toBe(5);

    // The tied-PR repo keeps both same-timestamp pull requests distinct.
    const tiesSeed = seeds.find((s) => s.name === PR_TIES_NAME);
    if (!tiesSeed) throw new Error('fixture missing PR-ties repo');
    const tiesRepoRow = await repository.findRepositoryByLogicalKey(
      BigInt(tiesSeed.id),
    );
    if (!tiesRepoRow) throw new Error('PR-ties repo not synced');
    expect(
      await prisma.collectionPullRequestFact.count({
        where: { repositoryId: tiesRepoRow.id },
      }),
    ).toBe(2);

    // Serial pacing: every dispatch (across the whole drain) is at least
    // 250ms apart on the virtual clock — deterministic, no real wall-clock
    // wait since `sleep` only advances the fake cursor.
    expect(dispatchTimes.length).toBeGreaterThan(0);
    for (let i = 1; i < dispatchTimes.length; i += 1) {
      expect(dispatchTimes[i]! - dispatchTimes[i - 1]!).toBeGreaterThanOrEqual(
        250,
      );
    }

    // Exact deterministic request/page count for the whole first-ever
    // backfill: one installation listing per run, plus each repository's
    // exact first-backfill cost (computed analytically from the fixture,
    // not asserted as a flaky threshold).
    const expectedTotal =
      runs.length +
      seeds.reduce((sum, s) => sum + firstBackfillRequestCost(s), 0);
    expect(provider.counters.total).toBe(expectedTotal);

    // Below a naive "no durable cursor" design that would redo a full pass
    // over all 100 repositories on every one of the budget-limited runs.
    const naiveFullRefetchBaseline =
      runs.length *
      seeds.reduce((sum, s) => sum + firstBackfillRequestCost(s), 0);
    expect(provider.counters.total).toBeLessThan(naiveFullRefetchBaseline);
  }, 120_000);

  it('a settled steady-state run performs zero fact writes and only conditional-style requests, except the no-ETag repository which pays extra requests for the same correctness', async () => {
    expect(initialDrainRuns.length).toBeGreaterThan(0);

    // One settling run: the commit stream's first post-backfill probe
    // captures a real ETag for every ETag-capable repository (backfill
    // itself always checkpoints etag=null).
    const settleResult = await service.run(OWNER_ID);
    expect(settleResult.cycleCompleted).toBe(true);

    const commitWritesBefore = commitWrites.length;
    const pullRequestWritesBefore = pullRequestWrites.length;
    const releaseWritesBefore = releaseWrites.length;
    const noEtagKey = `${ORG_LOGIN}/${NO_ETAG_NAME}`;
    const stableKey = `${ORG_LOGIN}/${STABLE_CONTRAST_NAME}`;
    const tiesKey = `${ORG_LOGIN}/${PR_TIES_NAME}`;
    const noEtagBefore = repoKindSnapshot(provider, noEtagKey);
    const stableBefore = repoKindSnapshot(provider, stableKey);
    const beforeByKind = { ...provider.counters.byKind };

    const stableResult = await service.run(OWNER_ID);

    expect(stableResult.cycleCompleted).toBe(true);
    expect(stableResult.processedRepositoryCount).toBe(REPO_COUNT);

    // Zero fact writes anywhere this run.
    const commitWritesThisRun = commitWrites
      .slice(commitWritesBefore)
      .reduce((a, b) => a + b, 0);
    const pullRequestWritesThisRun = pullRequestWrites
      .slice(pullRequestWritesBefore)
      .reduce((a, b) => a + b, 0);
    const releaseWritesThisRun = releaseWrites
      .slice(releaseWritesBefore)
      .reduce((a, b) => a + b, 0);
    expect(commitWritesThisRun).toBe(0);
    expect(pullRequestWritesThisRun).toBe(0);
    expect(releaseWritesThisRun).toBe(0);

    // Only conditional-style requests: no full commit/release listing
    // anywhere except the no-ETag repository (which can never 304 and so
    // must always fall back to a minimal list call).
    const afterByKind = { ...provider.counters.byKind };
    const kindDeltaThisRun = kindDelta(beforeByKind, afterByKind);
    expect(kindDeltaThisRun['installation']).toBe(1);
    expect(kindDeltaThisRun['commit-probe']).toBe(REPO_COUNT);
    expect(kindDeltaThisRun['release-probe']).toBe(REPO_COUNT);
    expect(kindDeltaThisRun['pull-list']).toBe(REPO_COUNT);
    // commit-list: only the no-ETag repo's mandatory minimal re-check.
    expect(kindDeltaThisRun['commit-list']).toBe(1);
    // release-list: only the no-ETag repo's mandatory full re-list.
    expect(kindDeltaThisRun['release-list']).toBe(1);

    // Per-repository contrast: an ETag-capable unchanged repo costs exactly
    // 3 requests this run (commit-probe + pull-list + release-probe); the
    // no-ETag repository — correct, but unable to use a 304 fast path —
    // costs exactly 5 (adds one minimal commit-list and one full
    // release-list).
    const noEtagAfter = repoKindSnapshot(provider, noEtagKey);
    const stableAfter = repoKindSnapshot(provider, stableKey);
    expect(totalKindDelta(stableBefore, stableAfter)).toBe(3);
    expect(totalKindDelta(noEtagBefore, noEtagAfter)).toBe(5);

    // The tied-PR repository still has exactly its original 2 facts.
    const tiesSeed = seeds.find((s) => s.name === PR_TIES_NAME);
    if (!tiesSeed) throw new Error('fixture missing PR-ties repo');
    const tiesRepoRow = await repository.findRepositoryByLogicalKey(
      BigInt(tiesSeed.id),
    );
    if (!tiesRepoRow) throw new Error('PR-ties repo not synced');
    expect(
      await prisma.collectionPullRequestFact.count({
        where: { repositoryId: tiesRepoRow.id },
      }),
    ).toBe(2);
    expect(repoKindSnapshot(provider, tiesKey)['pull-list']).toBeGreaterThan(0);
  }, 60_000);

  it('a disconnected (rewritten) commit history triggers a full recovery scan limited to only the affected repository', async () => {
    const seed = seeds.find((s) => s.name === DISCONNECTED_NAME);
    if (!seed) throw new Error('fixture missing disconnected repo');
    const rewritten = buildCommits(0, 8, '-rewritten');
    provider.mutate(ORG_LOGIN, DISCONNECTED_NAME, (repo) => {
      repo.commits = rewritten;
    });
    seed.commits = rewritten;

    const beforeByKind = { ...provider.counters.byKind };
    const result = await service.run(OWNER_ID);
    expect(result.cycleCompleted).toBe(true);
    const afterByKind = { ...provider.counters.byKind };
    const delta = kindDelta(beforeByKind, afterByKind);

    // The recovery scan is limited to exactly this repository's pages — the
    // only other `commit-list` contribution this run is the no-ETag repo's
    // constant mandatory minimal re-check (it can never 304; see the
    // steady-state test above), which fires every run regardless of what
    // else changed.
    expect(delta['commit-list']).toBe(syntheticPageCount(rewritten.length) + 1);

    const repoRow = await repository.findRepositoryByLogicalKey(
      BigInt(seed.id),
    );
    if (!repoRow) throw new Error('disconnected repo not synced');
    // Fact rows are append-only (never deleted on rewrite): the original 6
    // backfilled commits from the initial drain remain alongside the 8 newly
    // observed rewritten-history commits, for 14 total.
    expect(
      await prisma.collectionCommitFact.count({
        where: { repositoryId: repoRow.id },
      }),
    ).toBe(6 + rewritten.length);
  }, 60_000);

  it('a changed release probe triggers a full re-listing limited to only the affected repository, deduped by release id', async () => {
    const seed = seeds.find((s) => s.name === RELEASE_CHANGED_NAME);
    if (!seed) throw new Error('fixture missing release-changed repo');
    const additional = buildReleases(1, 1, '-added')[0];
    if (!additional) throw new Error('failed to build additional release');
    provider.mutate(ORG_LOGIN, RELEASE_CHANGED_NAME, (repo) => {
      repo.releases = [...repo.releases, additional];
    });
    seed.releases = [...seed.releases, additional];

    const beforeByKind = { ...provider.counters.byKind };
    const result = await service.run(OWNER_ID);
    expect(result.cycleCompleted).toBe(true);
    const afterByKind = { ...provider.counters.byKind };
    const delta = kindDelta(beforeByKind, afterByKind);

    // Same baseline note as the disconnected-recovery test above: the
    // no-ETag repo's mandatory full release re-list fires every run in
    // addition to this repository's own changed-probe re-list.
    expect(delta['release-list']).toBe(
      syntheticPageCount(seed.releases.length) + 1,
    );

    const repoRow = await repository.findRepositoryByLogicalKey(
      BigInt(seed.id),
    );
    if (!repoRow) throw new Error('release-changed repo not synced');
    expect(
      await prisma.collectionReleaseFact.count({
        where: { repositoryId: repoRow.id },
      }),
    ).toBe(2);
  }, 60_000);

  it('replaying an identical commit-fact batch after a simulated crash before the cursor advances writes zero duplicate facts', async () => {
    const seed = seeds.find((s) => s.name === STABLE_CONTRAST_NAME);
    if (!seed) throw new Error('fixture missing stable contrast repo');
    const repoRow = await repository.findRepositoryByLogicalKey(
      BigInt(seed.id),
    );
    if (!repoRow) throw new Error('stable contrast repo not synced');
    const before = await prisma.collectionCommitFact.count({
      where: { repositoryId: repoRow.id },
    });
    expect(before).toBeGreaterThan(0);

    const facts = seed.commits.map((commit) => ({
      sha: commit.sha,
      committedAt: new Date(commit.committedAt),
      authorGithubId: commit.authorId === null ? null : BigInt(commit.authorId),
      authorGithubLogin: commit.authorLogin,
    }));

    // Simulated crash-then-retry: the exact same fact batch is resent as if
    // the process had died after the provider call but before the cursor
    // advanced, and the caller simply retries from scratch.
    const first = await repository.recordCommitFacts(repoRow.id, facts);
    const second = await repository.recordCommitFacts(repoRow.id, facts);

    expect(first.insertedCount).toBe(0); // already recorded during the drain
    expect(second.insertedCount).toBe(0);
    expect(
      await prisma.collectionCommitFact.count({
        where: { repositoryId: repoRow.id },
      }),
    ).toBe(before);
  });

  it('a stale (stolen) lease aborts a fenced transaction with zero partial writes', async () => {
    // The shared `service` above always heartbeats/releases its lease using
    // the real wall clock (`CollectionSyncService`'s default `now`), so its
    // last `expiresAt` reflects whatever the actual current date is when
    // this suite runs. Clearing the row first makes the acquire below a
    // plain insert, keeping this test's own fixed timestamps
    // (`2026-01-01T00:00:00.000Z` onward) fully deterministic and
    // independent of that real-clock state.
    await prisma.collectionSyncLease.deleteMany({
      where: { appId: APP_ID, scope: SCOPE },
    });

    const now = new Date('2026-01-01T00:00:00.000Z');
    const stale = await repository.acquireSyncLease({
      appId: APP_ID,
      scope: SCOPE,
      ownerId: 'stale-owner',
      runId: 'stale-run',
      now,
      expiresAt: new Date(now.getTime() + 1_000),
    });
    expect(stale).not.toBeNull();
    if (!stale) throw new Error('expected to acquire the initial lease');

    const takeoverAt = new Date(now.getTime() + 2_000);
    const winner = await repository.acquireSyncLease({
      appId: APP_ID,
      scope: SCOPE,
      ownerId: 'winning-owner',
      runId: 'winning-run',
      now: takeoverAt,
      expiresAt: new Date(takeoverAt.getTime() + 60_000),
    });
    expect(winner).not.toBeNull();
    expect(winner?.epoch).toBe(stale.epoch + 1n);

    const seed = seeds.find((s) => s.name === STABLE_CONTRAST_NAME);
    if (!seed) throw new Error('fixture missing stable contrast repo');
    const repoRow = await repository.findRepositoryByLogicalKey(
      BigInt(seed.id),
    );
    if (!repoRow) throw new Error('stable contrast repo not synced');
    const before = await prisma.collectionCommitFact.count({
      where: { repositoryId: repoRow.id },
    });

    await expect(
      repository.runInTransaction(async (repo) => {
        await repo.assertSyncLeaseValid(stale, takeoverAt);
        await repo.recordCommitFacts(repoRow.id, [
          {
            sha: 'synthetic-stale-lease-write-attempt',
            committedAt: takeoverAt,
            authorGithubId: null,
            authorGithubLogin: null,
          },
        ]);
      }),
    ).rejects.toThrow('lease is stale');

    expect(
      await prisma.collectionCommitFact.count({
        where: { repositoryId: repoRow.id },
      }),
    ).toBe(before);

    // Clean up the winning lease so it does not interfere with any other
    // integration spec sharing this appId/scope.
    await repository.releaseSyncLease(
      winner!,
      new Date(takeoverAt.getTime() + 1),
    );
  });
});
