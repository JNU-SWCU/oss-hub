import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
const toolingPath = (file: string) =>
  resolve(
    __dirname,
    '../../../deploy/jenkins/program-migration/audit-log',
    file,
  );
const checkBeforeSql = readFileSync(toolingPath('check-before.sql'), 'utf8');
const checkCopySql = readFileSync(toolingPath('check-copy.sql'), 'utf8');

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

beforeEach(async () => {
  await resetAuditFixture(prisma);
  await applyAuditFixtureSql(prisma, prepareSql);
});

afterAll(async () => {
  await dropAuditFixture(prisma);
  await prisma.$disconnect();
});

it('keeps one routing definition across the migration and both checks', () => {
  const block = routeBlock(copySql);
  expect(block.length).toBeGreaterThan(1000);
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

  const addRow = (
    id: string,
    targetType: string,
    targetId: string,
    action: string,
    metadata = '{}',
  ) =>
    `INSERT INTO "AuditLog" (id, "actorId", action, "targetType", "targetId", metadata, "occurredAt")
     VALUES ('${id}', 'user-actor', '${action}', '${targetType}', '${targetId}', '${metadata}', '2026-09-02')`;

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
