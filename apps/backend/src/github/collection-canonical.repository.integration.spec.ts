import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionCanonicalRepository } from './repository/collection-canonical.repository';
import type {
  CanonicalGenerationInventory,
  CanonicalLeaseToken,
} from './collection-canonical.types';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const appId = 9_000_000_000_001_001n;
const organizationLogin = 'synthetic-org';
const repositoryId = 9_000_000_000_001_101n;
const now = new Date('2026-01-01T00:00:00.000Z');
const later = new Date('2026-01-01T00:01:00.000Z');
const rewriteAt = new Date('2026-01-01T00:00:15.000Z');
const emptyInventory: CanonicalGenerationInventory = {
  repositories: [],
  commits: [],
  pullRequests: [],
  releases: [],
  contributors: [],
};

const inventory = (suffix: string): CanonicalGenerationInventory => ({
  repositories: [
    {
      githubRepositoryId: repositoryId,
      fullName: 'synthetic-org/public-project',
      visibility: 'public',
      archived: false,
      defaultBranch: suffix === 'old' ? 'main' : 'stable',
    },
  ],
  commits: [
    {
      githubRepositoryId: repositoryId,
      sha: `synthetic-${suffix}`,
      committedAt: later,
      authorGithubId: 9_000_000_000_001_201n,
      authorGithubLogin: 'synthetic-contributor',
    },
  ],
  pullRequests:
    suffix === 'old'
      ? [
          {
            githubRepositoryId: repositoryId,
            githubPullRequestId: 9_000_000_000_001_301n,
            state: 'open',
            createdAt: now,
            authorGithubId: 9_000_000_000_001_201n,
            authorGithubLogin: 'synthetic-contributor',
          },
        ]
      : [
          {
            githubRepositoryId: repositoryId,
            githubPullRequestId: 9_000_000_000_001_301n,
            state: 'closed',
            createdAt: now,
            authorGithubId: 9_000_000_000_001_201n,
            authorGithubLogin: 'synthetic-contributor',
          },
        ],
  releases:
    suffix === 'old'
      ? [
          {
            githubRepositoryId: repositoryId,
            githubReleaseId: 9_000_000_000_001_401n,
            publishedAt: now,
            authorGithubId: 9_000_000_000_001_201n,
            authorGithubLogin: 'synthetic-contributor',
          },
        ]
      : [],
  contributors: [
    {
      githubRepositoryId: repositoryId,
      githubUserId: 9_000_000_000_001_201n,
      githubLogin: 'synthetic-contributor',
      commitCount: 1,
      pullRequestCount: 1,
      releaseCount: suffix === 'old' ? 1 : 0,
      currentYear: 2026,
      currentYearCommitCount: 1,
      currentYearPullRequestCount: 1,
      currentYearReleaseCount: suffix === 'old' ? 1 : 0,
    },
  ],
});

describe('CollectionCanonicalRepository integration', () => {
  const prisma = new PrismaService();
  const repository = new CollectionCanonicalRepository(prisma);

  beforeAll(() => prisma.$connect(), 60_000);
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CanonicalCollectionLease" WHERE "appId" = $1',
      appId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CanonicalOrganizationState" WHERE "appId" = $1',
      appId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CanonicalCollectionRun" WHERE "appId" = $1',
      appId,
    );
  });
  afterAll(() => prisma.$disconnect());

  async function candidate(
    runId: string,
    ownerId: string,
    at = now,
  ): Promise<CanonicalLeaseToken> {
    await repository.createCandidate({
      appId,
      organizationLogin,
      runId,
      checkedAt: at,
    });
    const lease = await repository.acquireLease({
      appId,
      organizationLogin,
      runId,
      ownerId,
      now: at,
      expiresAt: new Date(at.getTime() + 30_000),
    });
    expect(lease).not.toBeNull();
    await repository.markValidity(lease!, at, {
      installationValid: true,
      permissionsValid: true,
    });
    return lease!;
  }

  it('keeps the legacy collection schema while adding canonical tables', async () => {
    const [tables] = await prisma.$queryRawUnsafe<
      Array<{ legacy: string | null; canonical: string | null }>
    >(
      `SELECT to_regclass('"CollectionRun"')::text AS legacy,
              to_regclass('"CanonicalCollectionRun"')::text AS canonical`,
    );

    expect(tables).toEqual({
      legacy: '"CollectionRun"',
      canonical: '"CanonicalCollectionRun"',
    });
  });

  it('publishes a complete replacement and removes objects absent from current state', async () => {
    const first = await candidate('synthetic-generation-old', 'instance-a');
    await repository.writeGeneration(first, now, inventory('old'));
    await repository.completeAndPublish(first, now);
    const second = await candidate(
      'synthetic-generation-current',
      'instance-b',
      later,
    );
    expect(second.epoch).toBeGreaterThan(first.epoch);
    await repository.writeGeneration(second, later, inventory('current'));
    await repository.completeAndPublish(second, later);

    const [state] = await prisma.$queryRawUnsafe<
      Array<{ activeGenerationId: string }>
    >(
      'SELECT "activeGenerationId" FROM "CanonicalOrganizationState" WHERE "appId" = $1',
      appId,
    );
    const rows = await prisma.$queryRawUnsafe<
      Array<{ defaultBranch: string; sha: string; state: string }>
    >(
      'SELECT r."defaultBranch", c.sha, p.state FROM "CanonicalRepository" r JOIN "CanonicalDefaultBranchCommit" c USING ("generationId", "githubRepositoryId") JOIN "CanonicalPullRequest" p USING ("generationId", "githubRepositoryId") WHERE r."generationId" = $1',
      second.runId,
    );
    const releases = await prisma.$queryRawUnsafe<unknown[]>(
      'SELECT 1 FROM "CanonicalRelease" WHERE "generationId" = $1',
      second.runId,
    );
    if (state === undefined) {
      throw new Error('Expected canonical organization state to be published');
    }
    expect(state.activeGenerationId).toBe(second.runId);
    expect(rows).toEqual([
      { defaultBranch: 'stable', sha: 'synthetic-current', state: 'closed' },
    ]);
    expect(releases).toHaveLength(0);
  });

  it.each(['INCOMPLETE', 'RATE_LIMITED', 'FAILED'] as const)(
    '%s candidates preserve the prior active generation',
    async (status) => {
      const active = await candidate(
        `synthetic-active-${status}`,
        'instance-a',
      );
      await repository.writeGeneration(active, now, emptyInventory);
      await repository.completeAndPublish(active, now);
      const failed = await candidate(
        `synthetic-failed-${status}`,
        'instance-b',
        later,
      );
      await repository.finalizeFailure(
        failed,
        later,
        status,
        `SYNTHETIC_${status}`,
      );
      expect(
        (await repository.getStatusSnapshot({ appId, organizationLogin }))
          ?.activeGenerationId,
      ).toBe(active.runId);
      const retryAt = new Date(later.getTime() + 1);
      const retry = await candidate(
        `synthetic-retry-${status}`,
        'instance-c',
        retryAt,
      );
      expect(retry.epoch).toBeGreaterThan(failed.epoch);
      expect(retry.runId).toBe(`synthetic-retry-${status}`);
      await repository.finalizeFailure(
        retry,
        retryAt,
        'FAILED',
        'SYNTHETIC_RETRY_CLEANUP',
      );
    },
  );

  it('fences a stale owner after a second instance takes over an expired lease', async () => {
    const stale = await candidate('synthetic-stale-run', 'instance-a');
    const takeoverAt = new Date(now.getTime() + 31_000);
    await repository.createCandidate({
      appId,
      organizationLogin,
      runId: 'synthetic-winner-run',
      checkedAt: takeoverAt,
    });
    const winner = await repository.acquireLease({
      appId,
      organizationLogin,
      runId: 'synthetic-winner-run',
      ownerId: 'instance-b',
      now: takeoverAt,
      expiresAt: new Date(takeoverAt.getTime() + 30_000),
    });
    expect(winner?.epoch).toBe(stale.epoch + 1n);
    await expect(
      repository.writeGeneration(stale, takeoverAt, emptyInventory),
    ).rejects.toThrow('lease is stale');
  });

  it('supports an idempotent generation rewrite before publication', async () => {
    const lease = await candidate('synthetic-idempotent-run', 'instance-a');
    await repository.writeGeneration(lease, now, inventory('current'));
    await repository.writeGeneration(lease, rewriteAt, inventory('current'));
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      'SELECT 1 FROM "CanonicalRepository" WHERE "generationId" = $1',
      lease.runId,
    );
    expect(rows).toHaveLength(1);
  });
});
