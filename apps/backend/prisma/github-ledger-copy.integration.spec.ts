import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const PREFIX = 'ledger-copy-';
const GITHUB_ID = 9_811_000_001n;
const REPO_GITHUB_ID = 9_811_100_001n;
const ABSENT_REPO_GITHUB_ID = 9_811_100_002n;
const COPY_SQL = readFileSync(
  resolve(__dirname, 'github-ledger-copy.sql'),
  'utf8',
);
const VERIFY_SQL = readFileSync(
  resolve(__dirname, 'github-ledger-verify.sql'),
  'utf8',
);

const prisma = new PrismaClient();

type ReportRow = {
  readonly check: string;
  readonly expected: bigint;
  readonly actual: bigint;
};

const statements = (sql: string): string[] =>
  sql
    .split(/;\s*(?:\n|$)/)
    .map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(
      (statement) =>
        statement !== '' && statement !== 'BEGIN' && statement !== 'COMMIT',
    );

const copyLedger = async (): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    for (const statement of statements(COPY_SQL)) {
      await tx.$executeRawUnsafe(statement);
    }
  });
};

const verifyLedger = async (): Promise<ReportRow[]> =>
  prisma.$queryRawUnsafe<ReportRow[]>(VERIFY_SQL.trim().replace(/;\s*$/, ''));

describe('github ledger shadow copy', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it('copies the old rows once, keeps the old tables, and rejects an overlapping team period', async () => {
    const version = await prisma.$queryRaw<Array<{ server_version: string }>>`
      SHOW server_version
    `;
    expect(version[0]?.server_version.startsWith('17')).toBe(true);

    await clean();
    await seed();

    const derivedBefore = await prisma.contribution.count({
      where: { repository: { githubRepositoryId: REPO_GITHUB_ID } },
    });

    await copyLedger();
    const first = await verifyLedger();
    await copyLedger();
    const second = await verifyLedger();

    expect(second).toEqual(first);
    for (const row of second) {
      expect(row.actual).toBe(row.expected);
    }
    if (
      (await prisma.githubRepository.count({
        where: {
          githubRepositoryId: {
            notIn: [REPO_GITHUB_ID, ABSENT_REPO_GITHUB_ID],
          },
        },
      })) === 0
    ) {
      expect(second).toEqual([
        { check: 'repo_count', expected: 2n, actual: 2n },
        { check: 'open_team_link', expected: 1n, actual: 1n },
        { check: 'commit_count', expected: 2n, actual: 2n },
        { check: 'pull_request_count', expected: 1n, actual: 1n },
        { check: 'issue_count', expected: 1n, actual: 1n },
        { check: 'release_count', expected: 1n, actual: 1n },
        { check: 'latest_commit_sum', expected: 180n, actual: 180n },
        { check: 'latest_pull_request_sum', expected: 4n, actual: 4n },
        { check: 'latest_issue_sum', expected: 1n, actual: 1n },
        { check: 'latest_star_sum', expected: 2n, actual: 2n },
      ]);
    }

    const observations = await prisma.$queryRaw<Array<{ observed_at: Date }>>`
      SELECT "observed_at"
      FROM "github_user_activity_history"
      WHERE "github_id" = ${GITHUB_ID}
      ORDER BY "observed_at"
    `;
    expect(observations.map((row) => row.observed_at.toISOString())).toEqual([
      '2026-10-20T01:00:00.000Z',
      '2026-10-25T02:00:00.000Z',
    ]);

    const gone = await prisma.$queryRaw<Array<{ gone_at: Date | null }>>`
      SELECT "gone_at" FROM "repo" WHERE "github_repo_id" = ${ABSENT_REPO_GITHUB_ID}
    `;
    expect(gone[0]?.gone_at).not.toBeNull();

    expect(
      await prisma.contribution.count({
        where: { repository: { githubRepositoryId: REPO_GITHUB_ID } },
      }),
    ).toBe(derivedBefore);

    await expect(
      prisma.$queryRaw<Array<{ name: string }>>`
        SELECT to_regclass('public."Contribution"')::text AS name
      `,
    ).resolves.toEqual([{ name: '"Contribution"' }]);
    await expect(
      prisma.$queryRaw<Array<{ name: string }>>`
        SELECT to_regclass('public."GithubUserActivityHistory"')::text AS name
      `,
    ).resolves.toEqual([{ name: '"GithubUserActivityHistory"' }]);
    await expect(
      prisma.$queryRaw<Array<{ name: string }>>`
        SELECT to_regclass('public."CollectionRepositoryStream"')::text AS name
      `,
    ).resolves.toEqual([{ name: '"CollectionRepositoryStream"' }]);

    const otherTeamId = `${PREFIX}team-other`;
    await prisma.team.create({
      data: {
        id: otherTeamId,
        programId: `${PREFIX}program`,
        name: otherTeamId,
        leaderId: `${PREFIX}user`,
        applicantId: `${PREFIX}user`,
        answers: { title: otherTeamId },
        applicationTemplateVersion: 1,
      },
    });
    await expect(
      prisma.$executeRaw`
        INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
        VALUES (${otherTeamId}, ${REPO_GITHUB_ID}, ${new Date('2026-11-01T00:00:00.000Z')})
      `,
    ).rejects.toMatchObject({
      code: 'P2010',
      meta: { code: '23P01' },
    });
  });
});

async function seed(): Promise<void> {
  await prisma.user.create({
    data: {
      id: `${PREFIX}user`,
      githubId: GITHUB_ID,
      nickname: `${PREFIX}login`,
    },
  });
  await prisma.program.create({
    data: {
      id: `${PREFIX}program`,
      name: 'p',
      organizer: 'org',
      category: 'BASIC',
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-02T00:00:00.000Z'),
      startAt: new Date('2026-08-01T00:00:00.000Z'),
      endAt: new Date('2027-08-01T00:00:00.000Z'),
      description: 'd',
    },
  });
  await prisma.team.create({
    data: {
      id: `${PREFIX}team`,
      programId: `${PREFIX}program`,
      name: `${PREFIX}team`,
      leaderId: `${PREFIX}user`,
      applicantId: `${PREFIX}user`,
      answers: { title: `${PREFIX}team` },
      applicationTemplateVersion: 1,
    },
  });
  const linked = await prisma.githubRepository.create({
    data: {
      githubRepositoryId: REPO_GITHUB_ID,
      nameWithOwner: 'synthetic/ledger',
      source: 'ORG_PROVISIONED',
      teamId: `${PREFIX}team`,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    },
  });
  await prisma.githubRepository.create({
    data: {
      githubRepositoryId: ABSENT_REPO_GITHUB_ID,
      nameWithOwner: 'synthetic/gone',
      source: 'EXTERNAL_PUBLIC',
      presence: 'ABSENT',
    },
  });
  const occurredAt = new Date('2026-10-15T00:00:00.000Z');
  const seenAt = new Date('2026-10-16T00:00:00.000Z');
  await prisma.collectionCommitFact.create({
    data: {
      repositoryId: linked.id,
      sha: 'abc123',
      committedAt: occurredAt,
      authorGithubId: GITHUB_ID,
      observedAt: seenAt,
    },
  });
  await prisma.collectionCommitFact.create({
    data: {
      repositoryId: linked.id,
      sha: 'unauthored',
      committedAt: occurredAt,
      observedAt: seenAt,
    },
  });
  await prisma.collectionPullRequestFact.create({
    data: {
      repositoryId: linked.id,
      githubPullRequestId: 7n,
      state: 'open',
      createdAt: occurredAt,
      authorGithubId: GITHUB_ID,
      observedAt: seenAt,
    },
  });
  await prisma.githubIssueHistory.create({
    data: {
      repositoryId: linked.id,
      githubIssueId: 8n,
      state: 'open',
      createdAt: occurredAt,
      authorGithubId: GITHUB_ID,
      observedAt: seenAt,
    },
  });
  await prisma.collectionReleaseFact.create({
    data: {
      repositoryId: linked.id,
      githubReleaseId: 9n,
      publishedAt: occurredAt,
      authorGithubId: GITHUB_ID,
      observedAt: seenAt,
    },
  });
  await prisma.contribution.create({
    data: {
      repositoryId: linked.id,
      githubId: GITHUB_ID,
      date: new Date('2026-10-15T00:00:00.000Z'),
      commitCount: 2,
    },
  });
  await prisma.githubUserActivityHistory.create({
    data: {
      githubId: GITHUB_ID,
      githubLogin: `${PREFIX}login`,
      year: 2026,
      visibility: 'PUBLIC',
      commitCount: 180,
      pullRequestCount: 4,
      issueCount: 1,
      repositoryCount: 3,
      starCount: 2,
      observedAt: new Date('2026-10-25T02:00:00.000Z'),
    },
  });
  await prisma.githubUserActivityCycleSnapshot.create({
    data: {
      githubId: GITHUB_ID,
      githubLogin: `${PREFIX}login`,
      year: 2026,
      visibility: 'PUBLIC',
      commitCount: 120,
      pullRequestCount: 4,
      issueCount: 1,
      repositoryCount: 3,
      starCount: 2,
      observedAt: new Date('2026-10-20T01:00:00.000Z'),
    },
  });
  await prisma.githubUserActivityMonthly.create({
    data: {
      githubId: GITHUB_ID,
      year: 2026,
      month: 10,
      commitCount: 999,
      observedAt: new Date('2026-10-31T00:00:00.000Z'),
    },
  });
  await prisma.collectionRepositoryStream.create({
    data: { repositoryId: linked.id, streamType: 'COMMIT' },
  });
}

async function clean(): Promise<void> {
  const ledger = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT to_regclass('public.contribution') IS NOT NULL AS ready
  `;
  if (ledger[0]?.ready) {
    await prisma.$executeRaw`
      DELETE FROM "contribution"
      WHERE "repo_id" IN (${REPO_GITHUB_ID}, ${ABSENT_REPO_GITHUB_ID})
    `;
    await prisma.$executeRaw`
      DELETE FROM "team_repo"
      WHERE "repo_id" IN (${REPO_GITHUB_ID}, ${ABSENT_REPO_GITHUB_ID})
    `;
    await prisma.$executeRaw`
      DELETE FROM "repo"
      WHERE "github_repo_id" IN (${REPO_GITHUB_ID}, ${ABSENT_REPO_GITHUB_ID})
    `;
    await prisma.$executeRaw`
      DELETE FROM "github_user_activity_history" WHERE "github_id" = ${GITHUB_ID}
    `;
  }
  await prisma.collectionCommitFact.deleteMany({
    where: {
      repository: {
        githubRepositoryId: { in: [REPO_GITHUB_ID, ABSENT_REPO_GITHUB_ID] },
      },
    },
  });
  await prisma.collectionPullRequestFact.deleteMany({
    where: {
      repository: {
        githubRepositoryId: { in: [REPO_GITHUB_ID, ABSENT_REPO_GITHUB_ID] },
      },
    },
  });
  await prisma.collectionReleaseFact.deleteMany({
    where: {
      repository: {
        githubRepositoryId: { in: [REPO_GITHUB_ID, ABSENT_REPO_GITHUB_ID] },
      },
    },
  });
  await prisma.githubIssueHistory.deleteMany({
    where: {
      repository: {
        githubRepositoryId: { in: [REPO_GITHUB_ID, ABSENT_REPO_GITHUB_ID] },
      },
    },
  });
  await prisma.contribution.deleteMany({
    where: {
      repository: {
        githubRepositoryId: { in: [REPO_GITHUB_ID, ABSENT_REPO_GITHUB_ID] },
      },
    },
  });
  await prisma.collectionRepositoryStream.deleteMany({
    where: {
      repository: {
        githubRepositoryId: { in: [REPO_GITHUB_ID, ABSENT_REPO_GITHUB_ID] },
      },
    },
  });
  await prisma.githubUserActivityMonthly.deleteMany({
    where: { githubId: GITHUB_ID },
  });
  await prisma.githubUserActivityCycleSnapshot.deleteMany({
    where: { githubId: GITHUB_ID },
  });
  await prisma.githubUserActivityHistory.deleteMany({
    where: { githubId: GITHUB_ID },
  });
  await prisma.githubRepository.deleteMany({
    where: {
      githubRepositoryId: { in: [REPO_GITHUB_ID, ABSENT_REPO_GITHUB_ID] },
    },
  });
  await prisma.team.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.program.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}
