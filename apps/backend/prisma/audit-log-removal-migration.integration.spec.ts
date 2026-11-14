import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditLogReadRepository } from '../src/platform/audit-log-read.repository';
import {
  AuditLogReadService,
  type AuditLogRecord,
} from '../src/platform/audit-log-read.service';
import { PrismaService } from '../src/platform/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  applyAuditFixtureSql,
  bindAuditFixtureSql,
  COPIED_PROGRAM_ROWS,
  COPIED_TEAM_ROWS,
  dropAuditFixture,
  inAuditFixture,
  resetAuditFixture,
} from './audit-log-removal-migration.fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const migrationSql = (name: string) =>
  readFileSync(resolve(__dirname, 'migrations', name, 'migration.sql'), 'utf8');
const prepareSql = migrationSql('20261105220000_prepare_audit_history_events');
const copySql = migrationSql('20261105220100_copy_audit_log_to_domain_history');
const retireSql = migrationSql('20261106000000_retire_audit_log');
const toolingPath = (file: string) =>
  resolve(
    __dirname,
    '../../../deploy/jenkins/program-migration/audit-log',
    file,
  );
const checkBeforeSql = readFileSync(toolingPath('check-before.sql'), 'utf8');
const checkCopySql = readFileSync(toolingPath('check-copy.sql'), 'utf8');
const checkRetiredSql = readFileSync(toolingPath('check-retired.sql'), 'utf8');

const routeBlock = (sql: string) =>
  sql.slice(
    sql.indexOf('-- audit-log-route:start'),
    sql.indexOf('-- audit-log-route:end'),
  );

const execute = (sql: string) =>
  inAuditFixture(prisma, (transaction) => transaction.$executeRawUnsafe(sql));

const scalar = (sql: string) =>
  inAuditFixture(prisma, async (transaction) => {
    const rows = await transaction.$queryRawUnsafe<
      { value: bigint | number }[]
    >(`SELECT (${bindAuditFixtureSql(sql).replace(/;\s*$/, '')}) AS value`);
    return Number(rows[0]?.value);
  });

const check = (sql: string) =>
  inAuditFixture(prisma, async (transaction) => {
    const rows = await transaction.$queryRawUnsafe<Record<string, unknown>[]>(
      bindAuditFixtureSql(sql),
    );
    return Number(Object.values(rows[0] ?? {})[0]);
  });

const tableExists = (table: string) =>
  inAuditFixture(prisma, async (transaction) => {
    const rows = await transaction.$queryRawUnsafe<
      { present: string | null }[]
    >(`SELECT to_regclass('"${table}"')::text AS present`);
    return rows[0]?.present !== null;
  });

const SOURCE_ID_PREFIXES = /^(team|program|application)-audit:/;
const PAIRED_ROW_ALLOWANCE_MS = 1000;
const DELETE_BUCKET_ROWS = 11;
const RECORD_KEYS = [
  'action',
  'actor',
  'actorHandle',
  'id',
  'legacy',
  'metadata',
  'occurredAt',
  'target',
  'targetHandle',
  'targetId',
  'targetType',
];

const feedThroughRepository = () =>
  inAuditFixture(prisma, (transaction) =>
    new AuditLogReadService(
      new AuditLogReadRepository(transaction as never),
    ).list({ page: 1, limit: 100 }),
  );

const feedExpectedFromAuditLog = async () => {
  const rows = await inAuditFixture(prisma, (transaction) =>
    transaction.$queryRawUnsafe<Parameters<typeof mapStoredRows>[0]>(
      bindAuditFixtureSql(`
        ${routeBlock(copySql)}
        SELECT a.id, a."occurredAt", a.action, a."targetType", a."targetId", a.metadata,
          NULL::text AS "historyKind",
          jsonb_build_object('nickname', actor.login) AS actor,
          CASE a."targetType"
            WHEN 'PROGRAM' THEN program.name
            WHEN 'APPLICATION' THEN application_program.name
            WHEN 'REPOSITORY' THEN repo.owner_name END AS "joinedTarget"
        FROM "AuditLog" a
        JOIN routed ON routed.id = a.id AND routed.route NOT LIKE 'DELETE%'
        JOIN "User" actor ON actor.id = a."actorId"
        LEFT JOIN "Program" program ON a."targetType" = 'PROGRAM' AND program.id = a."targetId"
        LEFT JOIN program_team_backup.application_team_map map
          ON a."targetType" = 'APPLICATION' AND map."applicationId" = a."targetId"
        LEFT JOIN "Program" application_program ON application_program.id = map."programId"
        LEFT JOIN "repo" repo
          ON a."targetType" = 'REPOSITORY' AND repo.github_repo_id::text = a."targetId"
        ORDER BY a.id
      `),
    ),
  );
  return mapStoredRows(rows);
};

const mapStoredRows = async (
  rows: Awaited<ReturnType<AuditLogReadRepository['list']>>['rows'],
) =>
  (
    await new AuditLogReadService({
      list: () => Promise.resolve({ rows, total: rows.length }),
    }).list({ page: 1, limit: 100 })
  ).items;

const pairedAuditIds = () =>
  inAuditFixture(prisma, async (transaction) => {
    const rows = await transaction.$queryRawUnsafe<
      { id: string; auditId: string }[]
    >(
      `SELECT id, data->>'pairedAuditId' AS "auditId" FROM "TeamHistory" WHERE data ? 'pairedAuditId'`,
    );
    return new Map(rows.map((row) => [row.id, row.auditId]));
  });

const withoutIdAndTime = (record: AuditLogRecord) => ({
  ...record,
  id: '',
  occurredAt: new Date(0),
});

const addRow = (
  id: string,
  targetType: string,
  targetId: string,
  action: string,
  metadata = '{}',
) =>
  `INSERT INTO "AuditLog" (id, "actorId", action, "targetType", "targetId", metadata, "occurredAt")
   VALUES ('${id}', 'user-actor', '${action}', '${targetType}', '${targetId}', '${metadata}', '2026-09-02')`;

beforeEach(async () => {
  await resetAuditFixture(prisma);
  await applyAuditFixtureSql(prisma, prepareSql);
});

afterAll(async () => {
  await dropAuditFixture(prisma);
  await prisma.$disconnect();
});

it('keeps one routing definition across both migrations and both checks', () => {
  const block = routeBlock(copySql);
  expect(block.length).toBeGreaterThan(1000);
  expect(routeBlock(retireSql)).toBe(block);
  expect(routeBlock(checkBeforeSql)).toBe(block);
  expect(routeBlock(checkCopySql)).toBe(block);
});

describe('copy migration', () => {
  it('copies only rows with a domain target, verbatim and keyed on the audit row', async () => {
    const auditBefore = await scalar('SELECT count(*) FROM "AuditLog"');
    await expect(check(checkBeforeSql)).resolves.toBe(0);

    await applyAuditFixtureSql(prisma, copySql);

    await expect(check(checkCopySql)).resolves.toBe(0);
    await expect(scalar('SELECT count(*) FROM "AuditLog"')).resolves.toBe(
      auditBefore,
    );
    const team = await inAuditFixture(
      prisma,
      (transaction) => transaction.$queryRaw<
        {
          id: string;
          teamId: string;
          programId: string;
          event: string;
          actorId: string;
          source: string;
          sourceId: string;
          same: boolean;
        }[]
      >`
        SELECT h.id, h."teamId", h."programId", h.event::text, h."actorId", h.source::text, h."sourceId",
          h."occurredAt" = a."occurredAt"
            AND h.data = jsonb_build_object('schemaVersion', 1, 'action', a.action,
              'targetType', a."targetType", 'targetId', a."targetId", 'metadata', a.metadata) AS same
        FROM "TeamHistory" h JOIN "AuditLog" a ON a.id = h."sourceId"
        WHERE h.id LIKE 'team-audit:%' ORDER BY h."sourceId"
      `,
    );
    expect(
      team.map((row) => [row.sourceId, row.teamId, row.programId, row.event]),
    ).toEqual(
      [...COPIED_TEAM_ROWS].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
    for (const row of team) {
      expect(row).toMatchObject({
        id: `team-audit:${row.sourceId}`,
        actorId: 'user-actor',
        source: 'MIGRATION',
        same: true,
      });
    }
    const programs = await inAuditFixture(
      prisma,
      (transaction) => transaction.$queryRaw<
        {
          id: string;
          programId: string;
          event: string;
          sourceId: string;
          same: boolean;
        }[]
      >`
        SELECT h.id, h."programId", h.event::text, h."sourceId",
          h."occurredAt" = a."occurredAt"
            AND h.data = jsonb_build_object('schemaVersion', 1, 'action', a.action,
              'targetType', a."targetType", 'targetId', a."targetId", 'metadata', a.metadata) AS same
        FROM "ProgramHistory" h JOIN "AuditLog" a ON a.id = h."sourceId"
        ORDER BY h."sourceId"
      `,
    );
    expect(
      programs.map((row) => [row.sourceId, row.programId, row.event]),
    ).toEqual([...COPIED_PROGRAM_ROWS]);
    for (const row of programs) {
      expect(row).toMatchObject({
        id: `program-audit:${row.sourceId}`,
        same: true,
      });
    }
    await expect(
      scalar(`SELECT count(*) FROM "TeamHistory" WHERE "sourceId" IN
        ('team-gone', 'team-deleted-no-program', 'team-deleted-twin-program',
         'orphan-application', 'repository-no-team', 'repository-gone',
         'user-imported', 'role-imported', 'user-gone', 'collection-sync', 'submission-file')`),
    ).resolves.toBe(0);
  });

  it('applies on an empty database', async () => {
    await inAuditFixture(prisma, async (transaction) => {
      await transaction.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" DISABLE TRIGGER USER',
      );
      await transaction.$executeRawUnsafe('DELETE FROM "AuditLog"');
      await transaction.$executeRawUnsafe('DELETE FROM "TeamHistory"');
    });
    await applyAuditFixtureSql(prisma, copySql);
    await expect(scalar('SELECT count(*) FROM "ProgramHistory"')).resolves.toBe(
      0,
    );
  });

  it('tightens the event CHECK for the new event kinds and leaves native shapes strict', async () => {
    await applyAuditFixtureSql(prisma, copySql);
    const insert = (event: string, data: string, sourceTable = 'NULL') =>
      execute(`INSERT INTO "TeamHistory" (id, "teamId", "programId", event, source, "sourceTable", "sourceId", data)
        VALUES (gen_random_uuid()::text, 'team-live', 'program-live', '${event}', 'APPLICATION',
          ${sourceTable}, ${sourceTable === 'NULL' ? 'NULL' : 'gen_random_uuid()::text'}, '${data}')`);

    await expect(
      insert('JOINED', '{"schemaVersion":1,"metadata":{}}'),
    ).resolves.toBe(1);
    await expect(insert('JOINED', '{"schemaVersion":1}')).rejects.toThrow(
      'TeamHistory_event_data_check',
    );
    await expect(
      insert('RENAMED', '{"schemaVersion":1,"metadata":{}}'),
    ).rejects.toThrow('TeamHistory_event_data_check');
    await expect(
      insert('RENAMED', '{"schemaVersion":1,"metadata":{}}', "'AuditLog'"),
    ).resolves.toBe(1);
    await expect(
      execute(`INSERT INTO "ProgramHistory" (id, "programId", event, source, data)
        VALUES ('p', 'program-live', 'CREATED', 'APPLICATION', '{"schemaVersion":1}')`),
    ).rejects.toThrow('ProgramHistory_data_check');
  });

  it.each([
    [
      'an application row #1752 did not copy',
      addRow(
        'late',
        'APPLICATION',
        'application-mapped',
        'APPLICATION_SUBMITTED',
      ),
      'application_not_copied=1',
    ],
    [
      'a live user row the consolidation did not import',
      addRow('late', 'USER', 'user-target', 'USER_PROFILE_UPDATED'),
      'user_not_imported=1',
    ],
    [
      'a role request row the consolidation did not import',
      addRow('late', 'ROLE_REQUEST', 'request-2', 'ROLE_REQUEST_APPROVED'),
      'user_not_imported=1',
    ],
    [
      'an archived row on a live program',
      addRow('late', 'PROGRAM', 'program-live', 'PROGRAM_ARCHIVED'),
      'unrouted=1',
    ],
    [
      'a restored row on a live program',
      addRow('late', 'PROGRAM', 'program-live', 'PROGRAM_RESTORED'),
      'unrouted=1',
    ],
    [
      'a target type nobody owns',
      addRow('late', 'MYSTERY', 'x', 'MYSTERY_EVENT'),
      'unrouted=1',
    ],
    [
      'an unknown membership operation',
      addRow(
        'late',
        'TEAM',
        'team-live',
        'TEAM_MEMBERSHIP_CHANGED',
        '{"operation":"PROMOTE"}',
      ),
      'unrouted=1',
    ],
    [
      'a deletion row on a live team',
      addRow(
        'late',
        'TEAM',
        'team-live',
        'TEAM_DELETED',
        '{"programName":"Live Program"}',
      ),
      'unrouted=1',
    ],
    [
      'a connection change row on a live repository',
      addRow(
        'late',
        'REPOSITORY',
        'repository-with-team',
        'REPOSITORY_CONNECTION_CHANGED',
      ),
      'unrouted=1',
    ],
    [
      'copied metadata that is not an object',
      addRow('late', 'PROGRAM', 'program-live', 'PROGRAM_CREATED', '[1]'),
      'metadata_not_object=1',
    ],
  ])('aborts without copying on %s', async (_name, fault, message) => {
    await execute(fault);
    const teamBefore = await scalar('SELECT count(*) FROM "TeamHistory"');

    await expect(check(checkBeforeSql)).resolves.toBe(1);
    await expect(applyAuditFixtureSql(prisma, copySql)).rejects.toThrow(
      message,
    );

    await expect(tableExists('ProgramHistory')).resolves.toBe(false);
    await expect(scalar('SELECT count(*) FROM "TeamHistory"')).resolves.toBe(
      teamBefore,
    );
  });

  it('fails the copy check when a copied row is later altered or removed', async () => {
    await applyAuditFixtureSql(prisma, copySql);
    await execute(
      `DELETE FROM "TeamHistory" WHERE id = 'team-audit:team-joined'`,
    );
    await expect(check(checkCopySql)).resolves.toBe(1);
    await execute(
      `UPDATE "ProgramHistory" SET "programId" = 'other' WHERE id = 'program-audit:program-created'`,
    );
    await expect(check(checkCopySql)).resolves.toBe(2);
  });

  it('routes a late row to the copy check as missing, not as success', async () => {
    await applyAuditFixtureSql(prisma, copySql);
    await execute(
      `INSERT INTO "AuditLog" (id, "actorId", action, "targetType", "targetId", metadata, "occurredAt")
       VALUES ('late-created', 'user-actor', 'PROGRAM_CREATED', 'PROGRAM', 'program-live', '{}', '2026-09-03')`,
    );
    await expect(check(checkCopySql)).resolves.toBe(1);
  });
});

describe('audit screen parity after the copy', () => {
  it('shows every AuditLog row with a destination unchanged apart from its id', async () => {
    const expected = await feedExpectedFromAuditLog();
    await applyAuditFixtureSql(prisma, copySql);

    const feed = await feedThroughRepository();
    const paired = await pairedAuditIds();
    const sourceId = (id: string) =>
      paired.get(id) ?? id.replace(SOURCE_ID_PREFIXES, '');

    expect(feed.total).toBe(feed.items.length);
    expect(feed.items.map((item) => sourceId(item.id)).sort()).toEqual(
      expected.map((item) => item.id).sort(),
    );
    const actualBySource = new Map(
      feed.items.map((item) => [sourceId(item.id), item]),
    );
    for (const row of expected) {
      const actual = actualBySource.get(row.id);
      expect(actual).toBeDefined();
      if (actual === undefined) continue;
      expect(Object.keys(actual).sort()).toEqual(RECORD_KEYS);
      expect(actual.legacy).toBe(actual.metadata === null);
      expect(withoutIdAndTime(actual)).toEqual(withoutIdAndTime(row));
      const allowance = paired.has(actual.id) ? PAIRED_ROW_ALLOWANCE_MS : 0;
      expect(
        Math.abs(actual.occurredAt.getTime() - row.occurredAt.getTime()),
      ).toBeLessThanOrEqual(allowance);
    }
  });

  it('keeps per-action counts apart from the delete buckets', async () => {
    const expected = await feedExpectedFromAuditLog();
    await applyAuditFixtureSql(prisma, copySql);
    const countByAction = (rows: readonly AuditLogRecord[]) =>
      rows.reduce<Record<string, number>>(
        (counts, row) => ({
          ...counts,
          [row.action]: (counts[row.action] ?? 0) + 1,
        }),
        {},
      );

    const feed = await feedThroughRepository();

    expect(countByAction(feed.items)).toEqual(countByAction(expected));
    const actions = feed.items.map((item) => item.action);
    expect(actions).not.toContain('COLLECTION_SYNC_TRIGGERED');
    expect(actions).not.toContain('PROGRAM_ARCHIVED');
    await expect(scalar('SELECT count(*) FROM "AuditLog"')).resolves.toBe(
      feed.total + DELETE_BUCKET_ROWS,
    );
  });
});

describe('retire migration', () => {
  const count = (table: string) => scalar(`SELECT count(*) FROM "${table}"`);
  const counts = async () => [
    await count('AuditLog'),
    await count('TeamHistory'),
    await count('ProgramHistory'),
  ];

  it('copies rows the previous image wrote after the copy, then drops AuditLog', async () => {
    await applyAuditFixtureSql(prisma, copySql);
    await execute(
      addRow('late-created', 'PROGRAM', 'program-live', 'PROGRAM_CREATED'),
    );
    await execute(addRow('late-joined', 'TEAM', 'team-live', 'TEAM_JOINED'));
    await execute(
      `DELETE FROM "TeamHistory" WHERE id = 'team-audit:team-joined'`,
    );
    const teamBefore = await count('TeamHistory');
    const programBefore = await count('ProgramHistory');
    await expect(check(checkRetiredSql)).resolves.toBe(1);

    await applyAuditFixtureSql(prisma, retireSql);

    await expect(tableExists('AuditLog')).resolves.toBe(false);
    await expect(check(checkRetiredSql)).resolves.toBe(0);
    await expect(count('TeamHistory')).resolves.toBe(teamBefore + 2);
    await expect(count('ProgramHistory')).resolves.toBe(programBefore + 1);
    await expect(
      scalar(`SELECT count(*) FROM "ProgramHistory"
        WHERE id = 'program-audit:late-created' AND "programId" = 'program-live'
          AND event = 'CREATED' AND "actorId" = 'user-actor' AND data->'metadata' = '{}'`),
    ).resolves.toBe(1);
    await expect(
      scalar(`SELECT count(*) FROM "TeamHistory"
        WHERE id IN ('team-audit:late-joined', 'team-audit:team-joined')
          AND "teamId" = 'team-live' AND event = 'JOINED'`),
    ).resolves.toBe(2);
  });

  it.each([
    [
      'an application row #1752 did not copy',
      addRow(
        'late',
        'APPLICATION',
        'application-mapped',
        'APPLICATION_SUBMITTED',
      ),
      'application_not_copied=1',
    ],
    [
      'a live user row the consolidation did not import',
      addRow('late', 'USER', 'user-target', 'USER_PROFILE_UPDATED'),
      'user_not_imported=1',
    ],
    [
      'a connection change row on a live repository',
      addRow(
        'late',
        'REPOSITORY',
        'repository-with-team',
        'REPOSITORY_CONNECTION_CHANGED',
      ),
      'unrouted=1',
    ],
    [
      'a deletion row on a live team',
      addRow(
        'late',
        'TEAM',
        'team-live',
        'TEAM_DELETED',
        '{"programName":"Live Program"}',
      ),
      'unrouted=1',
    ],
    [
      'copied metadata that is not an object',
      addRow('late', 'PROGRAM', 'program-live', 'PROGRAM_CREATED', '[1]'),
      'metadata_not_object=1',
    ],
    [
      'a team copy altered after the copy migration',
      `UPDATE "TeamHistory" SET "actorId" = 'user-target' WHERE id = 'team-audit:team-joined'`,
      'team_missing=1',
    ],
    [
      'a program copy altered after the copy migration',
      `UPDATE "ProgramHistory" SET "programId" = 'other' WHERE id = 'program-audit:program-created'`,
      'program_missing=1',
    ],
  ])('aborts with no row deleted on %s', async (_name, fault, message) => {
    await applyAuditFixtureSql(prisma, copySql);
    await execute(fault);
    const before = await counts();

    await expect(applyAuditFixtureSql(prisma, retireSql)).rejects.toThrow(
      message,
    );

    await expect(tableExists('AuditLog')).resolves.toBe(true);
    await expect(check(checkRetiredSql)).resolves.toBe(1);
    await expect(counts()).resolves.toEqual(before);
  });
});
