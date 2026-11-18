import { Prisma } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  QueryRecordingPrisma,
  startQueryGrowthApp,
  type QueryGrowthApp,
} from '../../test/query-growth';
import {
  deleteRepos,
  relinkRepo,
  seedRepos,
} from '../../test/repo-ledger.fixture';
import { TEST_READ_LIMIT } from '../../test/test-read-limit.config';
import { PublicEligibilityRepository } from './public-eligibility.repository';
import { PlatformRepository } from '../platform/platform.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prefix = 'synthetic-landing-stats-';
const program = (id: number) => `${prefix}program-${id}`;
const team = (id: number) => `${prefix}team-${id}`;
const user = (id: number) => `${prefix}user-${id}`;
const githubId = (id: number) => 841_000_000n + BigInt(id);
const repoId = (id: number) => 842_000_000n + BigInt(id);
const date = new Date('2026-09-02T00:00:00Z');
const counts = (
  programCount: number,
  repositoryCount: number,
  contributorCount: number,
) => ({ programCount, repositoryCount, contributorCount });
const statsPath = '/api/v1/projects/landing-stats';
const db = new QueryRecordingPrisma();
let app: QueryGrowthApp;
let unpublished: readonly {
  readonly githubRepoId: bigint;
  readonly publishedAt: Date | null;
}[] = [];

async function request(path = statsPath) {
  const response = await fetch(app.baseUrl + path, {
    signal: AbortSignal.timeout(30_000),
  });
  return {
    status: response.status,
    cache: response.headers.get('cache-control'),
    body: (await response.json()) as unknown,
  };
}

async function addDays(
  repo: number,
  author: number,
  start: number,
  end: number,
) {
  await db.$executeRaw`
    INSERT INTO contribution
      (repo_id, kind, github_key, author_github_id, occurred_at, first_seen_at)
    SELECT ${repoId(repo)}, 'commit', 'day:' || day, ${githubId(author)},
      TIMESTAMPTZ '2000-01-01 00:00:00Z' + day * INTERVAL '1 day', ${date}
    FROM generate_series(${start}::int, ${end}::int) AS day
  `;
}

const event = (
  repo: number,
  author: number,
  day: number,
  kind: 'COMMIT' | 'PULL_REQUEST' | 'ISSUE' = 'COMMIT',
) => ({
  repoId: repoId(repo),
  authorGithubId: githubId(author),
  kind,
  githubKey: `fixture:${author}:${day}`,
  occurredAt: new Date(date.getTime() + day * 86_400_000),
  firstSeenAt: date,
});

describe('public Home stats over PostgreSQL and anonymous HTTP', () => {
  beforeAll(async () => {
    const existing = await db.repo.findMany({
      where: { visibility: 'PUBLIC', publishedAt: { not: null } },
      take: TEST_READ_LIMIT + 1,
      select: { githubRepoId: true, publishedAt: true },
    });
    expect(existing.length).toBeLessThanOrEqual(TEST_READ_LIMIT);
    if (existing.length > 0) {
      await db.repo.updateMany({
        where: {
          githubRepoId: {
            in: existing.map(({ githubRepoId }) => githubRepoId),
          },
        },
        data: { publishedAt: null },
      });
      unpublished = existing;
    }
    app = await startQueryGrowthApp(db);
  }, 30_000);

  beforeEach(async () => {
    await db.program.createMany({
      data: [1, 2, 3, 4].map((id) => ({
        id: program(id),
        name: program(id),
        startAt: date,
        endAt: new Date('2026-10-02T00:00:00Z'),
        organizers: ['fixture'],
        category: 'BASIC',
        applicationTemplateKey: 'fixture',
        applicationTemplateVersion: 1,
        applicationStartAt: date,
        applicationEndAt: date,
        description: 'fixture',
      })),
    });
    await db.user.createMany({
      data: ['alpha', 'beta', 'Gamma', 'alpha', 'Beta', ' ', 'excluded'].map(
        (nickname, index) => ({
          id: user(index + 1),
          githubId: githubId(index + 1),
          nickname,
          type: index === 6 ? 'UNSELECTED' : 'STUDENT',
        }),
      ),
    });
    await db.team.createMany({
      data: [1, 2, 3, 4, 5, 6].map((id) => ({
        id: team(id),
        programId: program(id <= 2 ? 1 : id <= 4 ? 2 : id === 5 ? 3 : 4),
        leaderId: user(id),
        applicantId: user(id),
        answers: {},
        name: team(id),
        applicationTemplateVersion: 1,
        status: 'APPROVED',
      })),
    });
    await seedRepos(
      db,
      [40, 30, 20, 10, 50].map((id, index) => ({
        teamId: team(index + 1),
        githubRepositoryId: repoId(id),
        nameWithOwner: `fixture/${prefix}${id}`,
        source: 'EXTERNAL_PUBLIC',
        publishedAt: date,
        visibility: id === 50 ? 'PRIVATE' : 'PUBLIC',
      })),
    );
  });

  afterEach(async () => {
    await deleteRepos(db, [10, 20, 30, 40, 50].map(repoId));
    await db.teamMember.deleteMany({
      where: { teamId: { startsWith: prefix } },
    });
    await db.team.deleteMany({ where: { id: { startsWith: prefix } } });
    await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
    await db.program.deleteMany({ where: { id: { startsWith: prefix } } });
  });

  afterAll(async () => {
    try {
      if (unpublished.length > 0) {
        await db.$executeRaw`
          UPDATE repo SET published_at = original.published_at
          FROM (VALUES ${Prisma.join(
            unpublished.map(
              ({ githubRepoId, publishedAt }) =>
                Prisma.sql`(${githubRepoId}::bigint, ${publishedAt}::timestamptz)`,
            ),
          )})
            AS original(repo_id, published_at)
          WHERE repo.github_repo_id = original.repo_id
        `;
      }
    } finally {
      await app?.close();
      await db.$disconnect();
    }
  });

  it.each(['forward', 'reverse'])(
    'matches detail ordering with %s insertion, using two authors and exact login dedupe',
    async (order) => {
      const events = [
        event(40, 3, 0),
        event(40, 2, 0),
        event(40, 1, 0),
        event(40, 1, 1),
        event(40, 6, 0, 'PULL_REQUEST'),
        event(30, 4, 0),
        event(30, 5, 0, 'PULL_REQUEST'),
        event(20, 3, 0, 'ISSUE'),
        event(20, 7, 0),
        event(10, 3, 0),
        event(50, 3, 0),
      ];
      await db.contributionEvent.createMany({
        data: order === 'forward' ? events : [...events].reverse(),
      });

      const page = await request('/api/v1/projects?pageSize=3');
      expect(page.body).toMatchObject({
        items: [40, 30, 20].map((id) => ({ projectId: repoId(id).toString() })),
      });
      const detail = await request(`/api/v1/projects/${repoId(40)}`);
      expect(detail.body).toMatchObject({
        contributors: ['alpha', 'beta', 'Gamma', ' '].map((githubLogin) => ({
          githubLogin,
        })),
      });
      expect(await request()).toEqual({
        status: 200,
        cache: 'no-store',
        body: counts(2, 3, 3),
      });
    },
  );

  it('uses publication time first and admits lookahead only after latest-link mapping drops a raw row', async () => {
    await db.repo.update({
      where: { githubRepoId: repoId(10) },
      data: { publishedAt: new Date('2026-09-03T00:00:00Z') },
    });
    await relinkRepo(db, repoId(40), team(6));
    await db.program.update({
      where: { id: program(4) },
      data: { lifecycle: 'DELETED' },
    });
    await db.contributionEvent.createMany({
      data: [event(10, 3, 0), event(40, 1, 0)],
    });

    expect((await request('/api/v1/projects?pageSize=3')).body).toMatchObject({
      items: [10, 30, 20].map((id) => ({ projectId: repoId(id).toString() })),
    });
    expect((await request()).body).toEqual(counts(2, 3, 1));
  });

  it('does not backfill after observation filtering and keeps equal-date absent repos with no contributors', async () => {
    await db.repo.update({
      where: { githubRepoId: repoId(40) },
      data: { presence: 'ABSENT', goneAt: new Date('2026-09-03T00:00:00Z') },
    });
    await db.repo.update({
      where: { githubRepoId: repoId(30) },
      data: { presence: 'ABSENT', goneAt: date },
    });
    await db.contributionEvent.createMany({
      data: [event(30, 1, 0), event(10, 3, 0)],
    });

    expect((await request()).body).toEqual(counts(2, 2, 0));
  });

  it.each(['program name', 'display name', 'selected login'] as const)(
    'makes all counts unavailable for invalid %s',
    async (invalid) => {
      if (invalid === 'program name') {
        await db.program.update({
          where: { id: program(1) },
          data: { name: ' ' },
        });
      } else if (invalid === 'display name') {
        await db.user.update({
          where: { id: user(1) },
          data: { nickname: ' ' },
        });
      } else {
        await db.contributionEvent.createMany({ data: [event(40, 6, 0)] });
      }
      expect((await request()).status).toBe(500);
    },
  );

  it('fails all stats when a sampled repo is withdrawn between the page and detail reads', async () => {
    const eligibility = new PublicEligibilityRepository(
      db,
      new PlatformRepository(),
    );
    const spy = jest
      .spyOn(
        PublicEligibilityRepository.prototype,
        'findRepositoryObservations',
      )
      .mockImplementationOnce(async (ids) => {
        const result = await eligibility.findRepositoryObservations(ids);
        await db.repo.update({
          where: { githubRepoId: repoId(40) },
          data: { visibility: 'PRIVATE' },
        });
        return result;
      });
    try {
      expect((await request()).status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns zero counts for a successful empty sample', async () => {
    await db.repo.updateMany({
      where: { githubRepoId: { in: [10, 20, 30, 40].map(repoId) } },
      data: { publishedAt: null },
    });
    expect(await request()).toEqual({
      status: 200,
      cache: 'no-store',
      body: counts(0, 0, 0),
    });
  });

  it('checks the nested member cap on the fourth row before slicing', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => index + 100);
    await db.user.createMany({
      data: ids.map((id) => ({
        id: user(id),
        githubId: githubId(id),
        nickname: user(id),
      })),
    });
    await db.teamMember.createMany({
      data: ids.map((id) => ({
        teamId: team(4),
        programId: program(2),
        userId: user(id),
      })),
    });
    expect((await request()).status).toBe(500);
  });

  it('keeps read calls fixed and enforces the daily overflow sentinel per repo, not across repos', async () => {
    const other = [10, 20, 30].map(repoId);
    await db.repo.updateMany({
      where: { githubRepoId: { in: other } },
      data: { publishedAt: null },
    });
    await addDays(40, 1, 1, 1);
    const one = await db.record(() => request());
    expect(one.result.body).toEqual(counts(1, 1, 1));

    await db.repo.updateMany({
      where: { githubRepoId: { in: other } },
      data: { publishedAt: date },
    });
    const three = await db.record(() => request());
    expect(three.result.body).toEqual(counts(2, 3, 1));
    await addDays(40, 1, 2, 50_000);
    await addDays(30, 2, 1, 2);
    const large = await db.record(() => request());
    expect(large.result.body).toEqual(counts(2, 3, 2));
    expect([one, three, large].map((sample) => sample.queries.count)).toEqual([
      one.queries.count,
      one.queries.count,
      one.queries.count,
    ]);
    expect(
      large.queries.statements.filter((sql) => sql.includes('day_counts AS')),
    ).toHaveLength(1);
    expect(large.queries.lintErrors).toEqual([]);
    console.info(
      `landing-stats SQL calls (one/three/large): ${one.queries.count}/${three.queries.count}/${large.queries.count}`,
    );

    await addDays(40, 1, 50_001, 50_001);
    expect((await request()).status).toBe(500);
  }, 40_000);
});
