import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { CollectionUserActivityRepository } from './repository-provision-job.repository';
import { PrismaService } from '../platform/prisma.service';
import { ContributorReadRepository } from '../platform/contributor-read.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const GITHUB_ID = 8_970_000_000_001n;
const CLOCK_ID = 8_970_000_000_021n;
const AUTHOR_MATCH = 8_970_000_000_011n;
const AUTHOR_DAILY = 8_970_000_000_012n;
const AUTHOR_EVENTS = 8_970_000_000_013n;
const AUTHOR_BOUNDARY = 8_970_000_000_014n;
const REPOSITORY_ID = 'synthetic-read-views-repository';
const GITHUB_REPOSITORY_ID = 8_970_000_100_001n;
const YEAR = 2119;

describe('contributor standing and repo contribution views', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await purge();
  });

  afterEach(async () => {
    await purge();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('uses the latest history row once when an older row and the old table disagree', async () => {
    await prisma.githubUserActivityObservation.createMany({
      data: [
        {
          githubId: GITHUB_ID,
          year: YEAR,
          visibility: 'PUBLIC',
          commitCount: 1,
          observedAt: new Date('2119-01-01T00:00:00.000Z'),
        },
        {
          githubId: GITHUB_ID,
          year: YEAR,
          visibility: 'PUBLIC',
          commitCount: 9,
          observedAt: new Date('2119-06-01T00:00:00.000Z'),
        },
      ],
    });
    await prisma.githubUserActivityHistory.create({
      data: {
        githubId: GITHUB_ID,
        githubLogin: 'synthetic-read-views',
        year: YEAR,
        visibility: 'PUBLIC',
        commitCount: 4,
        observedAt: new Date('2119-03-01T00:00:00.000Z'),
      },
    });

    const rows = await new ContributorReadRepository(prisma).readStandingRows({
      year: YEAR,
      visibility: 'PUBLIC',
    });
    const mine = rows.filter((row) => row.githubId === GITHUB_ID);

    expect(mine).toEqual([
      expect.objectContaining({
        githubId: GITHUB_ID,
        year: YEAR,
        visibility: 'PUBLIC',
        commitCount: 9,
      }),
    ]);
  });

  it('matches the old daily table when events exist and does not add the two sources', async () => {
    await seedRepository();
    const day = new Date('2026-08-01T00:00:00.000Z');
    await prisma.contributionEvent.createMany({
      data: [
        event('match-1', AUTHOR_MATCH, day),
        event('match-2', AUTHOR_MATCH, day),
        event('events-only', AUTHOR_EVENTS, day),
        event('null-author', null, day),
      ],
    });
    await prisma.contribution.createMany({
      data: [
        daily(AUTHOR_MATCH, day, 2),
        daily(AUTHOR_DAILY, day, 5),
        daily(AUTHOR_EVENTS, day, 9),
      ],
    });

    const rows = await readContribution();
    expect(countFor(rows, AUTHOR_MATCH, '2026-08-01')).toEqual({
      rows: 1,
      commitCount: 2,
    });
    expect(countFor(rows, AUTHOR_DAILY, '2026-08-01')).toEqual({
      rows: 1,
      commitCount: 5,
    });
    expect(countFor(rows, AUTHOR_EVENTS, '2026-08-01')).toEqual({
      rows: 1,
      commitCount: 1,
    });
    expect(rows.some((row) => row.githubId === null)).toBe(false);
  });

  it('moves the standing clock when the same counts are observed again', async () => {
    const first = new Date('2122-04-01T00:00:00.000Z');
    const second = new Date('2122-05-01T00:00:00.000Z');
    const counts = {
      commitCount: 8,
      pullRequestCount: 0,
      issueCount: 0,
      repositoryCount: 0,
      starCount: 0,
    };
    const repository = new CollectionUserActivityRepository(prisma);
    await repository.upsertObservation({
      githubId: CLOCK_ID,
      githubLogin: 'synthetic-read-views-clock',
      year: 2122,
      month: 4,
      ...counts,
      observedAt: first,
    });
    await repository.upsertObservation({
      githubId: CLOCK_ID,
      githubLogin: 'synthetic-read-views-clock',
      year: 2122,
      month: 4,
      ...counts,
      observedAt: second,
    });

    const rows = await prisma.$queryRaw<
      { observedAt: Date; commitCount: number }[]
    >`
      SELECT observed_at AS "observedAt", commit_count AS "commitCount"
      FROM contributor_standing
      WHERE github_id = ${CLOCK_ID}
        AND year = 2122
        AND visibility = 'PUBLIC'::"ActivityVisibility"
    `;

    expect(rows).toEqual([{ observedAt: second, commitCount: 8 }]);
  });

  it('splits the Asia/Seoul year boundary at midnight', async () => {
    await seedRepository();
    await prisma.contributionEvent.createMany({
      data: [
        event(
          'before-midnight',
          AUTHOR_BOUNDARY,
          new Date('2025-12-31T14:59:59.999Z'),
        ),
        event(
          'at-midnight',
          AUTHOR_BOUNDARY,
          new Date('2025-12-31T15:00:00.000Z'),
        ),
      ],
    });

    const rows = await readContribution();
    const dates = rows
      .filter((row) => row.githubId === AUTHOR_BOUNDARY)
      .map((row) => row.activityDate.toISOString().slice(0, 10))
      .sort();

    expect(dates).toEqual(['2025-12-31', '2026-01-01']);
  });

  it('is a view and a read takes only access share locks', async () => {
    const kinds = await prisma.$queryRaw<{ relkind: string }[]>`
      SELECT c.relkind
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('contributor_standing', 'repo_contribution')
      ORDER BY c.relname
    `;
    expect(kinds.map((kind) => kind.relkind)).toEqual(['v', 'v']);

    const locks = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM contributor_standing LIMIT 1`;
      await tx.$queryRaw`SELECT 1 FROM repo_contribution LIMIT 1`;
      return tx.$queryRaw<{ mode: string }[]>`
        SELECT l.mode
        FROM pg_locks AS l
        JOIN pg_class AS c ON c.oid = l.relation
        WHERE l.pid = pg_backend_pid()
          AND c.relname IN (
            'contributor_standing',
            'repo_contribution',
            'github_user_activity_history',
            'GithubUserActivityHistory',
            'contribution',
            'Contribution',
            'GithubRepository'
          )
      `;
    });

    expect(locks.length).toBeGreaterThan(0);
    expect(locks.every((lock) => lock.mode === 'AccessShareLock')).toBe(true);
  });
});

function event(
  key: string,
  authorGithubId: bigint | null,
  occurredAt: Date,
): {
  repoId: bigint;
  kind: 'COMMIT';
  githubKey: string;
  authorGithubId: bigint | null;
  occurredAt: Date;
  firstSeenAt: Date;
} {
  return {
    repoId: GITHUB_REPOSITORY_ID,
    kind: 'COMMIT',
    githubKey: key,
    authorGithubId,
    occurredAt,
    firstSeenAt: occurredAt,
  };
}

function daily(
  githubId: bigint,
  date: Date,
  commitCount: number,
): {
  repositoryId: string;
  githubId: bigint;
  date: Date;
  commitCount: number;
} {
  return {
    repositoryId: REPOSITORY_ID,
    githubId,
    date,
    commitCount,
  };
}

async function seedRepository(): Promise<void> {
  await prisma.githubRepository.create({
    data: {
      id: REPOSITORY_ID,
      githubRepositoryId: GITHUB_REPOSITORY_ID,
      nameWithOwner: 'synthetic/read-views',
      source: 'ORG_PROVISIONED',
    },
  });
  await prisma.repo.create({
    data: {
      githubRepoId: GITHUB_REPOSITORY_ID,
      ownerName: 'synthetic',
      source: 'ORG_PROVISIONED',
    },
  });
}

interface ContributionViewRow {
  readonly githubId: bigint | null;
  readonly activityDate: Date;
  readonly commitCount: number;
}

async function readContribution(): Promise<readonly ContributionViewRow[]> {
  return prisma.$queryRaw<ContributionViewRow[]>`
    SELECT
      github_id AS "githubId",
      activity_date AS "activityDate",
      commit_count AS "commitCount"
    FROM repo_contribution
    WHERE github_repository_id = ${GITHUB_REPOSITORY_ID}
  `;
}

function countFor(
  rows: readonly ContributionViewRow[],
  githubId: bigint,
  activityDate: string,
): { readonly rows: number; readonly commitCount: number } {
  const matched = rows.filter(
    (row) =>
      row.githubId === githubId &&
      row.activityDate.toISOString().slice(0, 10) === activityDate,
  );
  return {
    rows: matched.length,
    commitCount: matched.reduce((sum, row) => sum + row.commitCount, 0),
  };
}

async function purge(): Promise<void> {
  await prisma.contributionEvent.deleteMany({
    where: { repoId: GITHUB_REPOSITORY_ID },
  });
  await prisma.contribution.deleteMany({
    where: { repositoryId: REPOSITORY_ID },
  });
  await prisma.githubUserActivityMonthly.deleteMany({
    where: { githubId: CLOCK_ID },
  });
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: [GITHUB_ID, CLOCK_ID] } },
  });
  await prisma.githubUserActivityHistory.deleteMany({
    where: { githubId: { in: [GITHUB_ID, CLOCK_ID] } },
  });
  await prisma.repo.deleteMany({
    where: { githubRepoId: GITHUB_REPOSITORY_ID },
  });
  await prisma.githubRepository.deleteMany({
    where: { id: REPOSITORY_ID },
  });
}
