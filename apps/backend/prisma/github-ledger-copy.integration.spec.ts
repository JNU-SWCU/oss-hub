import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { RepositoryDeletionRepository } from '../src/platform/repository-deletion.repository';
import { TeamArchiveRepository } from '../src/programs/team.repository';
import { RepoLedgerRepository } from '../src/platform/repo-ledger.repository';
import { CollectionIncrementalRepository } from '../src/github/collection-incremental.repository';
import { PlatformRepository } from '../src/platform/platform.repository';
import type { PrismaService } from '../src/platform/prisma.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const PREFIX = 'ledger-copy-';
const GITHUB_ID = 9_811_000_001n;
const REPO_GITHUB_ID = 9_811_100_001n;
const ABSENT_REPO_GITHUB_ID = 9_811_100_002n;
const MOVE_REPO_GITHUB_ID = 9_811_100_003n;
const VIOLATION_REPO_GITHUB_ID = 9_811_100_004n;
const LEDGER_REPO_IDS = [
  REPO_GITHUB_ID,
  ABSENT_REPO_GITHUB_ID,
  MOVE_REPO_GITHUB_ID,
  VIOLATION_REPO_GITHUB_ID,
];
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

const statements = (sql: string): string[] => {
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const parts: string[] = [];
  let current = '';
  let fence: string | null = null;
  let inString = false;
  for (let index = 0; index < stripped.length; index += 1) {
    const rest = stripped.slice(index);
    if (fence) {
      if (rest.startsWith(fence)) {
        current += fence;
        index += fence.length - 1;
        fence = null;
        continue;
      }
      current += stripped[index];
      continue;
    }
    if (inString) {
      current += stripped[index];
      if (stripped[index] === "'" && stripped[index + 1] === "'") {
        current += "'";
        index += 1;
        continue;
      }
      if (stripped[index] === "'") inString = false;
      continue;
    }
    const marker = /^\$[A-Za-z0-9_]*\$/.exec(rest);
    if (marker) {
      fence = marker[0];
      current += fence;
      index += fence.length - 1;
      continue;
    }
    if (stripped[index] === "'") {
      inString = true;
      current += "'";
      continue;
    }
    if (stripped[index] === ';') {
      const statement = current.trim();
      if (statement !== '' && statement !== 'BEGIN' && statement !== 'COMMIT') {
        parts.push(statement);
      }
      current = '';
      continue;
    }
    current += stripped[index];
  }
  const tail = current.trim();
  if (tail !== '' && tail !== 'BEGIN' && tail !== 'COMMIT') parts.push(tail);
  return parts;
};

type OverlapCounts = {
  readonly teams: bigint;
  readonly team_rows: bigint;
  readonly repos: bigint;
  readonly repo_rows: bigint;
};

const overlapCounts = async (): Promise<OverlapCounts> => {
  const query = COPY_SQL.match(
    /-- begin-overlap\n([\s\S]*?)\n\s*-- end-overlap/,
  );
  const sql = query?.[1]?.trim();
  if (!sql) throw new Error('overlap query markers missing');
  const rows = await prisma.$queryRawUnsafe<OverlapCounts[]>(sql);
  const row = rows[0];
  if (!row) throw new Error('overlap query returned no row');
  return row;
};

const shadowTotals = async (): Promise<{
  readonly repo: bigint;
  readonly team_repo: bigint;
  readonly contribution: bigint;
}> => {
  const rows = await prisma.$queryRaw<
    Array<{ repo: bigint; team_repo: bigint; contribution: bigint }>
  >`
    SELECT
      (SELECT COUNT(*) FROM "repo") AS repo,
      (SELECT COUNT(*) FROM "team_repo") AS team_repo,
      (SELECT COUNT(*) FROM "contribution") AS contribution
  `;
  const row = rows[0];
  if (!row) throw new Error('shadow totals returned no row');
  return row;
};

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

  it('copies repositories once, leaves the activity ledger, and rejects an overlapping team period', async () => {
    const version = await prisma.$queryRaw<Array<{ server_version: string }>>`
      SHOW server_version
    `;
    expect(version[0]?.server_version.startsWith('17')).toBe(true);

    await clean();
    await seed();
    if (
      (await prisma.githubRepository.count({
        where: { githubRepositoryId: { notIn: [...LEDGER_REPO_IDS] } },
      })) === 0
    ) {
      expect(await overlapCounts()).toEqual({
        teams: 0n,
        team_rows: 0n,
        repos: 0n,
        repo_rows: 0n,
      });
    }

    await copyLedger();
    const first = await verifyLedger();
    await copyLedger();
    const second = await verifyLedger();

    expect(second).toEqual(first);
    expect(
      second.filter(
        (row) => row.check !== 'repo_count' && row.actual !== row.expected,
      ),
    ).toEqual([]);
    await expect(
      prisma.$queryRaw<Array<{ missing: bigint }>>`
        SELECT COUNT(*) AS missing
        FROM "GithubRepository" AS repository
        WHERE NOT EXISTS (
          SELECT 1
          FROM "repo"
          WHERE "repo"."github_repo_id" = repository."githubRepositoryId"
        )
      `,
    ).resolves.toEqual([{ missing: 0n }]);
    if (
      (await prisma.githubRepository.count({
        where: {
          githubRepositoryId: {
            notIn: [REPO_GITHUB_ID, ABSENT_REPO_GITHUB_ID],
          },
        },
      })) === 0 &&
      (await prisma.repo.count({
        where: {
          githubRepoId: { notIn: [REPO_GITHUB_ID, ABSENT_REPO_GITHUB_ID] },
        },
      })) === 0 &&
      (
        await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count FROM "github_user_activity_history"
          WHERE "github_id" <> ${GITHUB_ID}
        `
      )[0]?.count === 0n
    ) {
      expect(second).toEqual([
        { check: 'repo_count', expected: 2n, actual: 2n },
        { check: 'open_team_link', expected: 1n, actual: 1n },
        { check: 'latest_commit_sum', expected: 180n, actual: 180n },
        { check: 'latest_pull_request_sum', expected: 4n, actual: 4n },
        { check: 'latest_issue_sum', expected: 1n, actual: 1n },
        { check: 'latest_star_sum', expected: 2n, actual: 2n },
        { check: 'history_consecutive_same_value', expected: 0n, actual: 0n },
        { check: 'open_link_repo_mismatch', expected: 0n, actual: 0n },
        { check: 'open_period_created_at_floor', expected: 0n, actual: 0n },
      ]);
    }

    const observations = await prisma.$queryRaw<Array<{ observed_at: Date }>>`
      SELECT "observed_at"
      FROM "github_user_activity_history"
      WHERE "github_id" = ${GITHUB_ID}
      ORDER BY "observed_at"
    `;
    expect(observations.map((row) => row.observed_at.toISOString())).toEqual([
      '2026-10-25T02:00:00.000Z',
    ]);

    const gone = await prisma.$queryRaw<Array<{ gone_at: Date | null }>>`
      SELECT "gone_at" FROM "repo" WHERE "github_repo_id" = ${ABSENT_REPO_GITHUB_ID}
    `;
    expect(gone[0]?.gone_at).not.toBeNull();

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

  it('rejects two open repositories for one team and allows a move onto the next period', async () => {
    await clean();
    await seed();
    const teamId = `${PREFIX}team`;
    await prisma.$executeRaw`
      INSERT INTO "repo" ("github_repo_id", "owner_name", "source")
      VALUES
        (${REPO_GITHUB_ID}, 'synthetic/ledger', 'ORG_PROVISIONED'::"RepositorySource"),
        (${MOVE_REPO_GITHUB_ID}, 'synthetic/move', 'ORG_PROVISIONED'::"RepositorySource")
    `;
    await prisma.$executeRaw`
      INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
      VALUES (${teamId}, ${REPO_GITHUB_ID}, ${new Date('2026-10-01T00:00:00.000Z')})
    `;
    await expect(
      prisma.$executeRaw`
        INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
        VALUES (${teamId}, ${MOVE_REPO_GITHUB_ID}, ${new Date('2026-10-15T00:00:00.000Z')})
      `,
    ).rejects.toMatchObject({
      code: 'P2010',
      meta: { code: '23P01' },
    });

    await prisma.$executeRaw`
      UPDATE "team_repo"
      SET "valid_to" = ${new Date('2026-11-01T00:00:00.000Z')}
      WHERE "team_id" = ${teamId}
        AND "repo_id" = ${REPO_GITHUB_ID}
    `;
    await prisma.$executeRaw`
      INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
      VALUES (${teamId}, ${MOVE_REPO_GITHUB_ID}, ${new Date('2026-11-01T00:00:00.000Z')})
    `;
    const links = await prisma.$queryRaw<Array<{ repo_id: bigint }>>`
      SELECT "repo_id"
      FROM "team_repo"
      WHERE "team_id" = ${teamId}
      ORDER BY "valid_from"
    `;
    expect(links.map((link) => link.repo_id)).toEqual([
      REPO_GITHUB_ID,
      MOVE_REPO_GITHUB_ID,
    ]);
  });

  it('stops the copy and writes nothing when a team period would overlap', async () => {
    await clean();
    await seed();
    const teamId = `${PREFIX}team`;
    await prisma.githubRepository.create({
      data: {
        githubRepositoryId: VIOLATION_REPO_GITHUB_ID,
        nameWithOwner: 'synthetic/previous',
        source: 'ORG_PROVISIONED',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
    await prisma.$executeRaw`
      UPDATE "GithubRepository"
      SET "updatedAt" = ${new Date('2026-11-01T00:00:00.000Z')}
      WHERE "githubRepositoryId" = ${VIOLATION_REPO_GITHUB_ID}
    `;
    await prisma.$executeRaw`
      INSERT INTO "repo" ("github_repo_id", "owner_name", "source")
      VALUES (
        ${VIOLATION_REPO_GITHUB_ID},
        'synthetic/previous',
        'ORG_PROVISIONED'::"RepositorySource"
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
      VALUES (${teamId}, ${VIOLATION_REPO_GITHUB_ID}, ${new Date('2026-09-01T00:00:00.000Z')})
    `;
    const counts = await overlapCounts();
    if (
      (await prisma.githubRepository.count({
        where: { githubRepositoryId: { notIn: [...LEDGER_REPO_IDS] } },
      })) === 0
    ) {
      expect(counts).toEqual({
        teams: 1n,
        team_rows: 2n,
        repos: 0n,
        repo_rows: 0n,
      });
    }
    const before = await shadowTotals();
    let detail = '';
    try {
      await copyLedger();
    } catch (error) {
      detail = `${error instanceof Error ? error.message : ''} ${JSON.stringify(error)}`;
    }
    expect(detail).toContain(`overlapping_teams=${counts.teams}`);
    expect(detail).toContain(`overlapping_team_rows=${counts.team_rows}`);
    expect(detail).toContain(`overlapping_repos=${counts.repos}`);
    expect(detail).toContain(`overlapping_repo_rows=${counts.repo_rows}`);
    expect(await shadowTotals()).toEqual(before);
  });

  it('archives the team, closes open periods, and still rejects deleting the team row', async () => {
    await clean();
    await seed();
    const teamId = `${PREFIX}team`;
    const nextTeamId = `${PREFIX}team-next`;
    const archivedAt = new Date('2026-11-11T08:29:00.000Z');
    await prisma.$executeRaw`
      INSERT INTO "repo" ("github_repo_id", "owner_name", "source")
      VALUES (${REPO_GITHUB_ID}, 'synthetic/ledger', 'ORG_PROVISIONED'::"RepositorySource")
    `;
    await prisma.$executeRaw`
      INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
      VALUES (${teamId}, ${REPO_GITHUB_ID}, ${new Date('2026-10-01T00:00:00.000Z')})
    `;
    const before = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "team_repo" WHERE "team_id" = ${teamId}
    `;

    await prisma.$transaction((tx) =>
      new TeamArchiveRepository().run(tx, teamId, archivedAt),
    );
    await prisma.$transaction((tx) =>
      new TeamArchiveRepository().run(
        tx,
        teamId,
        new Date('2026-12-01T00:00:00.000Z'),
      ),
    );

    const team = await prisma.team.findUnique({ where: { id: teamId } });
    expect(team?.archivedAt).toEqual(archivedAt);
    const after = await prisma.$queryRaw<
      Array<{ count: bigint; open: bigint; valid_to: Date | null }>
    >`
      SELECT
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE "valid_to" IS NULL) AS open,
        MAX("valid_to") AS valid_to
      FROM "team_repo"
      WHERE "team_id" = ${teamId}
    `;
    expect(after[0]?.count).toBe(before[0]?.count);
    expect(after[0]?.open).toBe(0n);
    expect(after[0]?.valid_to).toEqual(archivedAt);

    const rule = await prisma.$queryRaw<Array<{ confdeltype: string }>>`
      SELECT "confdeltype"
      FROM "pg_constraint"
      WHERE "conname" = 'team_repo_team_id_fkey'
    `;
    expect(rule[0]?.confdeltype).toBe('r');
    await expect(
      prisma.$executeRaw`DELETE FROM "Team" WHERE "id" = ${teamId}`,
    ).rejects.toMatchObject({
      code: 'P2010',
      meta: { code: '23503' },
    });

    await prisma.team.create({
      data: {
        id: nextTeamId,
        programId: `${PREFIX}program`,
        name: nextTeamId,
        leaderId: `${PREFIX}user`,
        applicantId: `${PREFIX}user`,
        answers: { title: nextTeamId },
        applicationTemplateVersion: 1,
      },
    });
    await prisma.$executeRaw`
      INSERT INTO "team_repo" ("team_id", "repo_id", "valid_from")
      VALUES (${nextTeamId}, ${REPO_GITHUB_ID}, ${archivedAt})
    `;
    const successor = await prisma.$queryRaw<Array<{ open: bigint }>>`
      SELECT COUNT(*) FILTER (WHERE "valid_to" IS NULL) AS open
      FROM "team_repo"
      WHERE "team_id" = ${nextTeamId} AND "repo_id" = ${REPO_GITHUB_ID}
    `;
    expect(successor[0]?.open).toBe(1n);
  });

  it('removes a deleted repository from the ledger, opens the replacement, and repeats the same ledger', async () => {
    await clean();
    await seed();
    await copyLedger();
    const teamId = `${PREFIX}team`;
    const replacementAt = new Date('2026-11-02T03:04:05.000Z');
    const linked = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: REPO_GITHUB_ID },
      select: { id: true },
    });
    await prisma.$transaction((tx) =>
      new RepositoryDeletionRepository().deleteRepositoryWithFacts(
        tx,
        linked.id,
      ),
    );
    await prisma.githubRepository.create({
      data: {
        githubRepositoryId: MOVE_REPO_GITHUB_ID,
        nameWithOwner: 'synthetic/move',
        source: 'ORG_PROVISIONED',
        teamId,
        createdAt: replacementAt,
      },
    });
    await prisma.$executeRaw`
      UPDATE "GithubRepository"
      SET "updatedAt" = ${replacementAt}
      WHERE "githubRepositoryId" = ${MOVE_REPO_GITHUB_ID}
    `;

    await copyLedger();
    const links = async () =>
      prisma.$queryRaw<
        Array<{ repo_id: bigint; valid_from: Date; valid_to: Date | null }>
      >`
        SELECT "repo_id", "valid_from", "valid_to"
        FROM "team_repo"
        WHERE "team_id" = ${teamId}
        ORDER BY "valid_from", "repo_id"
      `;
    const repos = async () =>
      prisma.$queryRaw<Array<{ github_repo_id: bigint }>>`
        SELECT "github_repo_id"
        FROM "repo"
        WHERE "github_repo_id" IN (${REPO_GITHUB_ID}, ${MOVE_REPO_GITHUB_ID})
        ORDER BY "github_repo_id"
      `;
    const first = await links();
    const kept = await repos();
    expect(first).toEqual([
      {
        repo_id: MOVE_REPO_GITHUB_ID,
        valid_from: replacementAt,
        valid_to: null,
      },
    ]);
    expect(kept).toEqual([{ github_repo_id: MOVE_REPO_GITHUB_ID }]);
    expect(
      await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM "contribution"
        WHERE "repo_id" = ${REPO_GITHUB_ID}
      `,
    ).toEqual([{ count: 0n }]);
    expect(
      await prisma.githubRepository.findUnique({
        where: { githubRepositoryId: REPO_GITHUB_ID },
      }),
    ).toBeNull();

    await copyLedger();
    expect(await links()).toEqual(first);
    expect(await repos()).toEqual(kept);
  });

  it('reuses an older unlinked repository and keeps one open period', async () => {
    await clean();
    await seed();
    await copyLedger();
    const teamId = `${PREFIX}team`;
    const openedAt = new Date('2026-10-01T00:00:00.000Z');
    const claimAt = new Date('2026-11-05T04:06:07.000Z');
    await prisma.$executeRaw`
      UPDATE "GithubRepository"
      SET "teamId" = NULL
      WHERE "githubRepositoryId" = ${REPO_GITHUB_ID}
    `;
    await prisma.githubRepository.create({
      data: {
        githubRepositoryId: MOVE_REPO_GITHUB_ID,
        nameWithOwner: 'synthetic/unlinked',
        source: 'ORG_PROVISIONED',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });
    await prisma.$executeRaw`
      UPDATE "GithubRepository"
      SET "teamId" = ${teamId}, "updatedAt" = ${claimAt}
      WHERE "githubRepositoryId" = ${MOVE_REPO_GITHUB_ID}
        AND "teamId" IS NULL
    `;

    await copyLedger();
    const links = async () =>
      prisma.$queryRaw<
        Array<{ repo_id: bigint; valid_from: Date; valid_to: Date | null }>
      >`
        SELECT "repo_id", "valid_from", "valid_to"
        FROM "team_repo"
        WHERE "team_id" = ${teamId}
        ORDER BY "valid_from", "repo_id"
      `;
    const first = await links();
    expect(first).toEqual([
      {
        repo_id: REPO_GITHUB_ID,
        valid_from: openedAt,
        valid_to: claimAt,
      },
      {
        repo_id: MOVE_REPO_GITHUB_ID,
        valid_from: claimAt,
        valid_to: null,
      },
    ]);
    expect(first.filter((link) => link.valid_to === null)).toHaveLength(1);
    await copyLedger();
    expect(await links()).toEqual(first);
  });

  it('closes a detached repository whose updatedAt is older than the open period', async () => {
    await clean();
    await seed();
    await copyLedger();
    const teamId = `${PREFIX}team`;
    const openedAt = new Date('2026-10-01T00:00:00.000Z');
    const claimAt = new Date('2026-11-05T04:06:07.000Z');
    await prisma.$executeRaw`
      UPDATE "GithubRepository"
      SET "teamId" = NULL, "updatedAt" = ${new Date('2020-01-01T00:00:00.000Z')}
      WHERE "githubRepositoryId" = ${REPO_GITHUB_ID}
    `;
    await prisma.githubRepository.create({
      data: {
        githubRepositoryId: VIOLATION_REPO_GITHUB_ID,
        nameWithOwner: 'synthetic/replacement',
        source: 'ORG_PROVISIONED',
        teamId,
        createdAt: claimAt,
      },
    });
    await prisma.$executeRaw`
      UPDATE "GithubRepository"
      SET "updatedAt" = ${claimAt}
      WHERE "githubRepositoryId" = ${VIOLATION_REPO_GITHUB_ID}
    `;

    await copyLedger();
    const links = await prisma.$queryRaw<
      Array<{ repo_id: bigint; valid_from: Date; valid_to: Date | null }>
    >`
      SELECT "repo_id", "valid_from", "valid_to"
      FROM "team_repo"
      WHERE "team_id" = ${teamId}
      ORDER BY "valid_from", "repo_id"
    `;
    expect(links).toEqual([
      {
        repo_id: REPO_GITHUB_ID,
        valid_from: openedAt,
        valid_to: claimAt,
      },
      {
        repo_id: VIOLATION_REPO_GITHUB_ID,
        valid_from: claimAt,
        valid_to: null,
      },
    ]);
    await copyLedger();
    expect(
      await prisma.$queryRaw<
        Array<{ repo_id: bigint; valid_from: Date; valid_to: Date | null }>
      >`
        SELECT "repo_id", "valid_from", "valid_to"
        FROM "team_repo"
        WHERE "team_id" = ${teamId}
        ORDER BY "valid_from", "repo_id"
      `,
    ).toEqual(links);
  });

  it('keeps the copy and the verify clean after the app connects, reconnects, archives, and deletes', async () => {
    await clean();
    await seed();
    await copyLedger();
    const teamId = `${PREFIX}team`;
    const archivedTeamId = `${PREFIX}team-archived`;
    const ledger = new RepoLedgerRepository();
    const collection = new CollectionIncrementalRepository(
      prisma as PrismaService,
      new PlatformRepository(),
    );
    await prisma.team.create({
      data: {
        id: archivedTeamId,
        programId: `${PREFIX}program`,
        name: archivedTeamId,
        leaderId: `${PREFIX}user`,
        applicantId: `${PREFIX}user`,
        answers: { title: archivedTeamId },
        applicationTemplateVersion: 1,
      },
    });

    const connected = await prisma.$transaction(async (tx) => {
      const created = await tx.githubRepository.create({
        data: {
          githubRepositoryId: MOVE_REPO_GITHUB_ID,
          nameWithOwner: 'synthetic/connected',
          source: 'ORG_PROVISIONED',
          visibility: 'PUBLIC',
          teamId: archivedTeamId,
        },
        select: { id: true },
      });
      await ledger.link(tx, MOVE_REPO_GITHUB_ID);
      return created;
    });
    await collection.refreshRepositoryObservation({
      source: 'ORG_PROVISIONED',
      githubRepositoryId: MOVE_REPO_GITHUB_ID,
      nameWithOwner: 'synthetic/renamed',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      observedAt: new Date('2026-11-14T00:00:00.000Z'),
    });
    await collection.recordRepositorySuccess(
      [MOVE_REPO_GITHUB_ID],
      new Date('2026-11-14T01:00:00.000Z'),
    );

    const replaced = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: REPO_GITHUB_ID },
      select: { id: true },
    });
    await prisma.$transaction(async (tx) => {
      await new RepositoryDeletionRepository().deleteRepositoryWithFacts(
        tx,
        replaced.id,
      );
      await tx.githubRepository.create({
        data: {
          githubRepositoryId: VIOLATION_REPO_GITHUB_ID,
          nameWithOwner: 'synthetic/reconnected',
          source: 'EXTERNAL_PUBLIC',
          teamId,
        },
      });
      await ledger.link(tx, VIOLATION_REPO_GITHUB_ID);
    });
    await collection.markRepositoryGone(
      ABSENT_REPO_GITHUB_ID,
      new Date('2026-11-14T02:00:00.000Z'),
      'EXTERNAL_PUBLIC',
    );

    await prisma.$transaction(async (tx) => {
      await new RepositoryDeletionRepository().deleteRepositoryWithFacts(
        tx,
        connected.id,
      );
      await new TeamArchiveRepository().run(
        tx,
        archivedTeamId,
        new Date('2026-11-14T03:00:00.000Z'),
      );
    });

    const ledgerRows = async () => ({
      repos: await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "repo"
        WHERE "github_repo_id" IN (${Prisma.join(LEDGER_REPO_IDS)})
        ORDER BY "github_repo_id"
      `,
      links: await prisma.$queryRaw<
        Array<{
          team_id: string;
          repo_id: bigint;
          valid_from: Date;
          valid_to: Date | null;
        }>
      >`
        SELECT "team_id", "repo_id", "valid_from", "valid_to"
        FROM "team_repo"
        WHERE "team_id" IN (${teamId}, ${archivedTeamId})
        ORDER BY "team_id", "valid_from"
      `,
    });
    const written = await ledgerRows();
    expect(written.repos.map((row) => row.github_repo_id)).toEqual([
      ABSENT_REPO_GITHUB_ID,
      VIOLATION_REPO_GITHUB_ID,
    ]);
    expect(
      written.links.map(({ team_id, repo_id, valid_to }) => ({
        team_id,
        repo_id,
        open: valid_to === null,
      })),
    ).toEqual([
      { team_id: teamId, repo_id: VIOLATION_REPO_GITHUB_ID, open: true },
    ]);

    await copyLedger();
    expect(await ledgerRows()).toEqual(written);
    const report = await verifyLedger();
    expect(
      report.filter(
        (row) => row.check !== 'repo_count' && row.actual !== row.expected,
      ),
    ).toEqual([]);
    await expect(
      prisma.$queryRaw<Array<{ missing: bigint }>>`
        SELECT COUNT(*) AS missing
        FROM "GithubRepository" AS repository
        WHERE repository."githubRepositoryId" IN (${Prisma.join(LEDGER_REPO_IDS)})
          AND NOT EXISTS (
            SELECT 1
            FROM "repo"
            WHERE "repo"."github_repo_id" = repository."githubRepositoryId"
          )
      `,
    ).resolves.toEqual([{ missing: 0n }]);
    const drift = await prisma.$queryRaw<Array<{ drift: bigint }>>`
      SELECT COUNT(*) AS drift
      FROM "GithubRepository" AS repository
      JOIN "repo" ON "repo"."github_repo_id" = repository."githubRepositoryId"
      WHERE repository."githubRepositoryId" IN (${Prisma.join(LEDGER_REPO_IDS)})
        AND (
          repository."nameWithOwner",
          repository."defaultBranch",
          repository."archived",
          repository."visibility"::text,
          repository."presence"::text,
          repository."lastSuccessAt" AT TIME ZONE 'UTC',
          repository."publishedAt" AT TIME ZONE 'UTC'
        ) IS DISTINCT FROM (
          "repo"."owner_name",
          "repo"."default_branch",
          "repo"."archived",
          "repo"."visibility"::text,
          "repo"."presence"::text,
          "repo"."last_success_at",
          "repo"."published_at"
        )
    `;
    expect(drift).toEqual([{ drift: 0n }]);
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
  await prisma.$executeRaw`
    UPDATE "GithubRepository"
    SET "updatedAt" = "createdAt"
    WHERE "githubRepositoryId" = ${REPO_GITHUB_ID}
  `;
  await prisma.githubRepository.create({
    data: {
      githubRepositoryId: ABSENT_REPO_GITHUB_ID,
      nameWithOwner: 'synthetic/gone',
      source: 'EXTERNAL_PUBLIC',
      presence: 'ABSENT',
    },
  });
  await prisma.$executeRaw`
    INSERT INTO "github_user_activity_history" (
      "github_id", "year", "visibility", "commit_count", "pull_request_count",
      "issue_count", "repository_count", "star_count", "observed_at"
    ) VALUES (
      ${GITHUB_ID}, 2026, 'PUBLIC', 180, 4, 1, 3, 2,
      ${new Date('2026-10-25T02:00:00.000Z')}
    )
  `;
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
      WHERE "repo_id" IN (${REPO_GITHUB_ID}, ${ABSENT_REPO_GITHUB_ID}, ${MOVE_REPO_GITHUB_ID}, ${VIOLATION_REPO_GITHUB_ID})
    `;
    await prisma.$executeRaw`
      DELETE FROM "team_repo"
      WHERE "repo_id" IN (${REPO_GITHUB_ID}, ${ABSENT_REPO_GITHUB_ID}, ${MOVE_REPO_GITHUB_ID}, ${VIOLATION_REPO_GITHUB_ID})
    `;
    await prisma.$executeRaw`
      DELETE FROM "repo"
      WHERE "github_repo_id" IN (${REPO_GITHUB_ID}, ${ABSENT_REPO_GITHUB_ID}, ${MOVE_REPO_GITHUB_ID}, ${VIOLATION_REPO_GITHUB_ID})
    `;
    await prisma.$executeRaw`
      DELETE FROM "github_user_activity_history" WHERE "github_id" = ${GITHUB_ID}
    `;
  }
  await prisma.collectionRepositoryStream.deleteMany({
    where: {
      repository: {
        githubRepositoryId: { in: [...LEDGER_REPO_IDS] },
      },
    },
  });
  await prisma.githubRepository.deleteMany({
    where: {
      githubRepositoryId: { in: [...LEDGER_REPO_IDS] },
    },
  });
  await prisma.team.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.program.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}
