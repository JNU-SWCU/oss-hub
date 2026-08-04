import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
import type { CanonicalGenerationInventory } from './collection-canonical.types';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { CollectionReadService } from './collection-read.service';

/**
 * F3 감사 갭 대응 — ADR-006 "누적 저장소로의 1회 전환과 이전 세대 보존" §4의 rollback 계약은
 * 런타임 코드 경로(스위치/토글)가 아니다: `collection.module.ts`/`collection-scheduler.service.ts`/
 * `collection-read.service.ts`가 명시하듯 old writer(`CollectionReconciliationService`)와 old
 * canonical 테이블(`Canonical*`)은 "rollback 참조용"으로 provider/코드에 남아 있을 뿐 어떤
 * controller·scheduler·admin trigger도 더 이상 그것들을 배선하지 않는다. 즉 rollback은 이
 * 저장소의 old release를 재배포하는 운영 절차이며, 그 절차가 성립하려면 old canonical 테이블의
 * 데이터가 cutover 이후 새 증분 writer(`CollectionSyncService`/`CollectionIncrementalRepository`)
 * 활동에 의해 조금도 바뀌지 않아야 한다. 이 스위트는 그 유일하게 실행 가능한 불변식 —
 * "새 writer는 old canonical 테이블을 절대 건드리지 않는다, 따라서 old release를 재배포하면
 * cutover 이전과 동일한 데이터를 그대로 읽는다" — 을 실 Postgres로 고정한다. rollback 자체가
 * 코드가 아니라 배포 절차라는 판단은 test-only이며 프로덕션 동작을 바꾸지 않는다.
 */

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

// Deliberately distinct from every other integration suite's synthetic
// identities (9_000_000_000_001_xxx / 9_000_000_000_002_xxx / 9_000_000_300_xxx)
// so this file's rows can never collide with another suite's, even though
// `run-backend-integration.sh` runs every `*.integration.spec.ts` file
// serially (`--runInBand`) against the same isolated database.
const oldAppId = 9_000_000_000_005_001n;
const oldOrganizationLogin = 'synthetic-rollback-org';
const oldRepositoryId = 9_000_000_000_005_101n;
const oldContributorId = 9_000_000_000_005_201n;

const newGithubOrganizationId = 9_000_000_000_005_301n;
const newGithubRepositoryId = 9_000_000_000_005_401n;
const newContributorId = 9_000_000_000_005_501n;

const publishedAt = new Date('2026-01-01T00:00:00.000Z');

const oldGenerationInventory: CanonicalGenerationInventory = {
  repositories: [
    {
      githubRepositoryId: oldRepositoryId,
      fullName: `${oldOrganizationLogin}/pre-cutover-project`,
      visibility: 'public',
      archived: false,
      defaultBranch: 'main',
    },
  ],
  commits: [
    {
      githubRepositoryId: oldRepositoryId,
      sha: 'synthetic-pre-cutover-commit',
      committedAt: publishedAt,
      authorGithubId: oldContributorId,
      authorGithubLogin: 'synthetic-pre-cutover-contributor',
    },
  ],
  pullRequests: [
    {
      githubRepositoryId: oldRepositoryId,
      githubPullRequestId: 9_000_000_000_005_601n,
      state: 'closed',
      createdAt: publishedAt,
      authorGithubId: oldContributorId,
      authorGithubLogin: 'synthetic-pre-cutover-contributor',
    },
  ],
  releases: [
    {
      githubRepositoryId: oldRepositoryId,
      githubReleaseId: 9_000_000_000_005_701n,
      publishedAt,
      authorGithubId: oldContributorId,
      authorGithubLogin: 'synthetic-pre-cutover-contributor',
    },
  ],
  contributors: [
    {
      githubRepositoryId: oldRepositoryId,
      githubUserId: oldContributorId,
      githubLogin: 'synthetic-pre-cutover-contributor',
      commitCount: 1,
      pullRequestCount: 1,
      releaseCount: 1,
      currentYear: 2026,
      currentYearCommitCount: 1,
      currentYearPullRequestCount: 1,
      currentYearReleaseCount: 1,
    },
  ],
};

/** bigint-safe deep snapshot for row-level equality assertions below. */
function snapshotRows(rows: readonly Record<string, unknown>[]): string {
  const bigintSafe = (_key: string, value: unknown): unknown =>
    typeof value === 'bigint' ? `bigint:${value.toString()}` : value;
  return JSON.stringify(rows, bigintSafe);
}

describe('Collection cutover rollback data-preservation contract (ADR-006, F3 audit gap)', () => {
  const prisma = new PrismaService();
  const canonicalRepository = new CollectionCanonicalRepository(prisma);
  const incrementalRepository = new CollectionIncrementalRepository(prisma);
  const readService = new CollectionReadService(prisma, canonicalRepository);

  let beforeCanonicalRepositoryRows = '';
  let beforeCanonicalCommitRows = '';
  let beforeCanonicalPullRequestRows = '';
  let beforeCanonicalReleaseRows = '';
  let beforeCanonicalContributorRows = '';
  let beforeOrganizationState: { activeGenerationId: string } | undefined;
  let beforeStatusSnapshot: Awaited<
    ReturnType<CollectionReadService['getStatusSnapshot']>
  >;
  let beforeRankingActivity: Awaited<
    ReturnType<CollectionReadService['findRankingActivity']>
  >;

  beforeAll(async () => {
    await prisma.$connect();

    // Seed a published pre-cutover canonical generation exactly the way the
    // old writer (`CollectionReconciliationService`) would have — mirrors
    // `collection-canonical.repository.integration.spec.ts`'s own seeding
    // pattern so this fixture stays representative of the real old writer.
    await canonicalRepository.createCandidate({
      appId: oldAppId,
      organizationLogin: oldOrganizationLogin,
      runId: 'synthetic-pre-cutover-generation',
      checkedAt: publishedAt,
    });
    const lease = await canonicalRepository.acquireLease({
      appId: oldAppId,
      organizationLogin: oldOrganizationLogin,
      runId: 'synthetic-pre-cutover-generation',
      ownerId: 'synthetic-old-writer-instance',
      now: publishedAt,
      expiresAt: new Date(publishedAt.getTime() + 30_000),
    });
    if (!lease) throw new Error('failed to acquire seed lease');
    await canonicalRepository.markValidity(lease, publishedAt, {
      installationValid: true,
      permissionsValid: true,
    });
    await canonicalRepository.writeGeneration(
      lease,
      publishedAt,
      oldGenerationInventory,
    );
    await canonicalRepository.completeAndPublish(lease, publishedAt);

    // Capture the "if we redeployed the old release right now" snapshot —
    // both the raw old-canonical rows and the exact DTOs the old reader
    // (`CollectionReadService.findRankingActivity`/`getStatusSnapshot`, kept
    // wired only as rollback-reference code per `collection-read.service.ts`)
    // would hand back to a caller.
    beforeCanonicalRepositoryRows = snapshotRows(
      await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM "CanonicalRepository" WHERE "generationId" = $1 ORDER BY "githubRepositoryId"',
        lease.runId,
      ),
    );
    beforeCanonicalCommitRows = snapshotRows(
      await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM "CanonicalDefaultBranchCommit" WHERE "generationId" = $1 ORDER BY sha',
        lease.runId,
      ),
    );
    beforeCanonicalPullRequestRows = snapshotRows(
      await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM "CanonicalPullRequest" WHERE "generationId" = $1 ORDER BY "githubPullRequestId"',
        lease.runId,
      ),
    );
    beforeCanonicalReleaseRows = snapshotRows(
      await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM "CanonicalRelease" WHERE "generationId" = $1 ORDER BY "githubReleaseId"',
        lease.runId,
      ),
    );
    beforeCanonicalContributorRows = snapshotRows(
      await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM "CanonicalContributorProjection" WHERE "generationId" = $1 ORDER BY "githubUserId"',
        lease.runId,
      ),
    );
    const [organizationState] = await prisma.$queryRawUnsafe<
      Array<{ activeGenerationId: string }>
    >(
      'SELECT "activeGenerationId" FROM "CanonicalOrganizationState" WHERE "appId" = $1 AND "organizationLogin" = $2',
      oldAppId,
      oldOrganizationLogin,
    );
    beforeOrganizationState = organizationState;

    beforeStatusSnapshot = await readService.getStatusSnapshot();
    beforeRankingActivity = await readService.findRankingActivity({});

    // Now run genuine new-writer activity — todo 14's live writer surface
    // (`CollectionIncrementalRepository`, the same repository
    // `CollectionSyncService` calls through) — against a completely
    // disjoint synthetic repository/org, simulating real post-cutover
    // collection cycles happening after the pre-cutover generation above
    // was published.
    const newRepository =
      await incrementalRepository.recordRepositoryObservation({
        githubOrganizationId: newGithubOrganizationId,
        githubRepositoryId: newGithubRepositoryId,
        nameWithOwner: 'synthetic-rollback-org/post-cutover-project',
        defaultBranch: 'main',
        archived: false,
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        source: 'ORG_PROVISIONED',
        observedAt: new Date('2026-02-01T00:00:00.000Z'),
      });
    await incrementalRepository.recordCommitFacts(newRepository.id, [
      {
        sha: 'synthetic-post-cutover-commit',
        committedAt: new Date('2026-02-01T00:00:00.000Z'),
        authorGithubId: newContributorId,
        authorGithubLogin: 'synthetic-post-cutover-contributor',
      },
    ]);
    await incrementalRepository.recordPullRequestFacts(newRepository.id, [
      {
        githubPullRequestId: 9_000_000_000_005_801n,
        state: 'open',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        authorGithubId: newContributorId,
        authorGithubLogin: 'synthetic-post-cutover-contributor',
      },
    ]);
    await incrementalRepository.recordReleaseFacts(newRepository.id, [
      {
        githubReleaseId: 9_000_000_000_005_901n,
        publishedAt: new Date('2026-02-01T00:00:00.000Z'),
        authorGithubId: newContributorId,
        authorGithubLogin: 'synthetic-post-cutover-contributor',
      },
    ]);
    await incrementalRepository.upsertSyncCursor({
      appId: newGithubOrganizationId,
      scope: 'org:synthetic-rollback-org',
      lastGithubRepositoryId: newGithubRepositoryId,
      cycleStartedAt: new Date('2026-02-01T00:00:00.000Z'),
      cycleCompletedAt: new Date('2026-02-01T00:05:00.000Z'),
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionCommitFact" WHERE "repositoryId" IN (SELECT id FROM "GithubRepository" WHERE "githubOrganizationId" = $1)',
      newGithubOrganizationId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionPullRequestFact" WHERE "repositoryId" IN (SELECT id FROM "GithubRepository" WHERE "githubOrganizationId" = $1)',
      newGithubOrganizationId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionReleaseFact" WHERE "repositoryId" IN (SELECT id FROM "GithubRepository" WHERE "githubOrganizationId" = $1)',
      newGithubOrganizationId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionRepositoryYearAggregate" WHERE "repositoryId" IN (SELECT id FROM "GithubRepository" WHERE "githubOrganizationId" = $1)',
      newGithubOrganizationId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionContributorYearAggregate" WHERE "repositoryId" IN (SELECT id FROM "GithubRepository" WHERE "githubOrganizationId" = $1)',
      newGithubOrganizationId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CollectionSyncCursor" WHERE "appId" = $1',
      newGithubOrganizationId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "GithubRepository" WHERE "githubOrganizationId" = $1',
      newGithubOrganizationId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CanonicalCollectionLease" WHERE "appId" = $1',
      oldAppId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CanonicalOrganizationState" WHERE "appId" = $1',
      oldAppId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CanonicalCollectionRun" WHERE "appId" = $1',
      oldAppId,
    );
    await prisma.$disconnect();
  });

  it('새 증분 writer가 활동을 기록한 뒤에도 pre-cutover canonical generation의 원장 행은 바이트 단위로 그대로 남는다', async () => {
    const runId = 'synthetic-pre-cutover-generation';

    const afterCanonicalRepositoryRows = snapshotRows(
      await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM "CanonicalRepository" WHERE "generationId" = $1 ORDER BY "githubRepositoryId"',
        runId,
      ),
    );
    const afterCanonicalCommitRows = snapshotRows(
      await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM "CanonicalDefaultBranchCommit" WHERE "generationId" = $1 ORDER BY sha',
        runId,
      ),
    );
    const afterCanonicalPullRequestRows = snapshotRows(
      await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM "CanonicalPullRequest" WHERE "generationId" = $1 ORDER BY "githubPullRequestId"',
        runId,
      ),
    );
    const afterCanonicalReleaseRows = snapshotRows(
      await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM "CanonicalRelease" WHERE "generationId" = $1 ORDER BY "githubReleaseId"',
        runId,
      ),
    );
    const afterCanonicalContributorRows = snapshotRows(
      await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM "CanonicalContributorProjection" WHERE "generationId" = $1 ORDER BY "githubUserId"',
        runId,
      ),
    );
    const [organizationStateAfter] = await prisma.$queryRawUnsafe<
      Array<{ activeGenerationId: string }>
    >(
      'SELECT "activeGenerationId" FROM "CanonicalOrganizationState" WHERE "appId" = $1 AND "organizationLogin" = $2',
      oldAppId,
      oldOrganizationLogin,
    );

    expect(afterCanonicalRepositoryRows).toBe(beforeCanonicalRepositoryRows);
    expect(afterCanonicalCommitRows).toBe(beforeCanonicalCommitRows);
    expect(afterCanonicalPullRequestRows).toBe(beforeCanonicalPullRequestRows);
    expect(afterCanonicalReleaseRows).toBe(beforeCanonicalReleaseRows);
    expect(afterCanonicalContributorRows).toBe(beforeCanonicalContributorRows);
    expect(organizationStateAfter).toEqual(beforeOrganizationState);
    expect(organizationStateAfter?.activeGenerationId).toBe(runId);

    // Sanity: the new writer actually did write something real, so the
    // "unchanged" assertions above are not vacuously true.
    const newFactCount = await prisma.collectionCommitFact.count({
      where: { repository: { githubOrganizationId: newGithubOrganizationId } },
    });
    expect(newFactCount).toBe(1);
  });

  it('old canonical 테이블만 읽는 rollback 참조 reader(CollectionReadService.getStatusSnapshot/findRankingActivity)는 새 writer 활동 이후에도 정확히 같은 값을 반환한다', async () => {
    const afterStatusSnapshot = await readService.getStatusSnapshot();
    const afterRankingActivity = await readService.findRankingActivity({});

    expect(afterStatusSnapshot).toEqual(beforeStatusSnapshot);
    expect(afterRankingActivity).toEqual(beforeRankingActivity);

    // Sanity: the pre-cutover reader still resolves the seeded generation
    // (not an empty/null fallback that would make the equality trivial).
    expect(afterStatusSnapshot?.runStatus).toBe('SUCCEEDED');
    expect(afterRankingActivity).toEqual([
      expect.objectContaining({
        githubId: oldContributorId,
        githubLogin: 'synthetic-pre-cutover-contributor',
        commitCount: 1,
        prCount: 1,
        releaseCount: 1,
      }),
    ]);
  });
});
