import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  artifact,
  cleanupMigrationFixture,
  forward,
  inMigrationDatabase,
  migrationId,
  prepareMigrationFixture,
  sourceSnapshot,
  sql,
  resolveFailedMigration,
  schemaDrift,
} from './user-consolidation-migration-harness';

jest.setTimeout(120_000);
beforeAll(prepareMigrationFixture);
afterAll(cleanupMigrationFixture);

it('preserves every source field through committed forward reverse and replay', async () => {
  await inMigrationDatabase(async (url) => {
    const before = await sourceSnapshot(url);
    const baselineDrift = await schemaDrift(url, 'before');
    await sql(url, await artifact('preflight'));
    await forward(url);
    await sql(url, await artifact('reconcile'));
    expect(await schemaDrift(url, 'after')).toBe(baselineDrift);
    process.stdout.write(
      `TASK2_SCHEMA_DRIFT ${JSON.stringify(baselineDrift)}\n`,
    );
    process.stdout.write(
      `TASK2_SOURCE_SHA256 ${createHash('sha256').update(before).digest('hex')}\n`,
    );
    process.stdout.write(
      `TASK2_COUNTS ${await sql(
        url,
        `SELECT jsonb_build_object(
      'postgres',current_setting('server_version'),'users',(SELECT count(*) FROM "User"),
      'admins',(SELECT count(*) FROM "Admin"),'userHistories',(SELECT count(*) FROM "UserHistory"),
      'adminHistories',(SELECT count(*) FROM "AdminHistory"),'policies',(SELECT count(*) FROM "UserPolicy"),
      'auditSources',(SELECT count(*) FROM "AuditLog"))`,
      )}\n`,
    );
    expect(
      await sql(
        url,
        `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
      ),
    ).toBe('50');
    await sql(
      url,
      `SET oss_hub.user_consolidation_rollback='FENCED';\n${await artifact('rollback')}`,
    );
    expect(await sourceSnapshot(url)).toBe(before);
    await sql(
      url,
      `SET oss_hub.user_consolidation_rollback='FENCED';\n${await artifact('rollback')}`,
    );
    expect(await sourceSnapshot(url)).toBe(before);
    await forward(url);
    await sql(url, await artifact('reconcile'));
  });
});

it('starts a fresh generation after rollback and acknowledged old application writes while preserving prior evidence', async () => {
  await inMigrationDatabase(async (url) => {
    await forward(url);
    const previous = await sql(
      url,
      `SELECT jsonb_build_object(
        'source',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name,id) FROM user_consolidation_backup.source_rows t),
        'forward',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name,id) FROM user_consolidation_backup.forward_rows t))`,
    );
    await sql(
      url,
      `SET oss_hub.user_consolidation_rollback='FENCED';\n${await artifact('rollback')}`,
    );
    const archive = await sql(
      url,
      `SELECT 'user_consolidation_backup_' || oid FROM pg_namespace WHERE nspname='user_consolidation_backup'`,
    );
    const attempts = await sql(
      url,
      `SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM user_consolidation_backup.ledger_attempts t`,
    );
    expect(
      await sql(
        url,
        `SELECT count(*) FROM user_consolidation_backup.ledger_attempts`,
      ),
    ).toBe('1');
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    try {
      expect(
        await prisma.$transaction([
          prisma.$executeRaw`UPDATE "User" SET phone='00012345678' WHERE id='student-admin'`,
          prisma.$executeRaw`INSERT INTO "Consent" (id,"userId","policyVersion","consentedAt")
            VALUES ('consent:retry','student-admin','2026-11-02','2026-11-02')`,
        ]),
      ).toEqual([1, 1]);
    } finally {
      await prisma.$disconnect();
    }
    const latest = await sourceSnapshot(url);
    await forward(url);
    await sql(url, await artifact('reconcile'));
    expect(
      await sql(
        url,
        `SELECT jsonb_build_object(
          'source',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name,id) FROM ${archive}.source_rows t),
          'forward',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name,id) FROM ${archive}.forward_rows t))`,
      ),
    ).toBe(previous);
    expect(
      await sql(
        url,
        `SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM ${archive}.ledger_attempts t`,
      ),
    ).toBe(attempts);
    for (const statement of [
      `DELETE FROM ${archive}.source_rows`,
      `TRUNCATE ${archive}.forward_rows`,
      `UPDATE ${archive}.ledger_attempts SET data='{}'`,
      `UPDATE ${archive}.control SET phase='FENCED'`,
      `INSERT INTO ${archive}.ledger_attempts VALUES ('forbidden','{}')`,
    ]) {
      await expect(sql(url, statement)).rejects.toThrow(/append-only/);
    }
    await sql(
      url,
      `SET oss_hub.user_consolidation_rollback='FENCED';\n${await artifact('rollback')}`,
    );
    expect(await sourceSnapshot(url)).toBe(latest);
    expect(await sql(url, `SELECT phase FROM ${archive}.control`)).toBe(
      'ROLLED_BACK',
    );
    expect(
      await sql(
        url,
        `SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM ${archive}.ledger_attempts t`,
      ),
    ).toBe(attempts);
  });
});

it('rejects source tampering within a fenced attempt instead of refreshing its snapshot', async () => {
  await inMigrationDatabase(async (url) => {
    const before = await sourceSnapshot(url);
    const migration = await readFile(
      join(process.cwd(), 'prisma/migrations', migrationId, 'migration.sql'),
      'utf8',
    );
    await expect(
      sql(
        url,
        migration.replace(
          '-- checkpoint: snapshot',
          `-- checkpoint: snapshot
UPDATE public."User" SET phone='00012345678' WHERE id='student-admin';`,
        ),
      ),
    ).rejects.toThrow(/account field conservation mismatch/);
    expect(await sourceSnapshot(url)).toBe(before);
    expect(
      await sql(
        url,
        `SELECT to_regnamespace('user_consolidation_backup') IS NULL`,
      ),
    ).toBe('t');
  });
});

it.each(['preflight', 'reconcile'])(
  'ships the same executable %s block in standalone and atomic migration SQL',
  async (name) => {
    const migration = await readFile(
      join(process.cwd(), 'prisma/migrations', migrationId, 'migration.sql'),
      'utf8',
    );
    const standalone = await artifact(name);
    const start = `DO $${name}$`;
    const end = `$${name}$;`;
    expect(
      migration.slice(
        migration.indexOf(start),
        migration.indexOf(end) + end.length,
      ),
    ).toBe(
      standalone.slice(
        standalone.indexOf(start),
        standalone.indexOf(end) + end.length,
      ),
    );
  },
);

it('refuses rollback after a write or without the maintenance decision', async () => {
  await inMigrationDatabase(async (url) => {
    await forward(url);
    await expect(sql(url, await artifact('rollback'))).rejects.toThrow(
      /FENCED/,
    );
    await sql(
      url,
      `UPDATE "User" SET "sessionVersion"="sessionVersion"+1 WHERE id='student-admin'`,
    );
    await expect(
      sql(
        url,
        `SET oss_hub.user_consolidation_rollback='FENCED';\n${await artifact('rollback')}`,
      ),
    ).rejects.toThrow(/changed since migration/);
    expect(
      await sql(url, `SELECT to_regclass('"UserPolicy"') IS NOT NULL`),
    ).toBe('t');
  });
});

it('rejects rollback after OPEN_COMMITTED even when no application write has occurred', async () => {
  await inMigrationDatabase(async (url) => {
    await forward(url);
    await sql(url, await artifact('open'));
    await sql(url, await artifact('open'));
    await expect(
      sql(
        url,
        `SET oss_hub.user_consolidation_rollback='FENCED';\n${await artifact('rollback')}`,
      ),
    ).rejects.toThrow(/post-open/);
  });
});

it.each(['snapshot', 'copy', 'history', 'switch'])(
  'rolls back every SQL write on forced %s failure',
  async (checkpoint) => {
    await inMigrationDatabase(async (url) => {
      const before = await sourceSnapshot(url);
      const migration = await readFile(
        join(process.cwd(), 'prisma/migrations', migrationId, 'migration.sql'),
        'utf8',
      );
      const marker = `-- checkpoint: ${checkpoint}`;
      if (!migration.includes(marker))
        throw new TypeError(`Missing checkpoint ${checkpoint}`);
      await expect(
        forward(url, migration.replace(marker, `${marker}\nSELECT 1/0;`)),
      ).rejects.toThrow(/current transaction is aborted/);
      expect(await sourceSnapshot(url)).toBe(before);
      expect(
        await sql(
          url,
          `SELECT to_regnamespace('user_consolidation_backup') IS NULL`,
        ),
      ).toBe('t');
      expect(
        await sql(
          url,
          `SELECT count(*) FROM _prisma_migrations WHERE migration_name='${migrationId}'
      AND finished_at IS NULL AND rolled_back_at IS NULL`,
        ),
      ).toBe('1');
      await resolveFailedMigration(url);
      await forward(url);
      await sql(url, await artifact('reconcile'));
    });
  },
);
