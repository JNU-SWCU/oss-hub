import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  artifact,
  cleanupMigrationFixture,
  forward,
  inMigrationDatabase,
  migrationId,
  prepareMigrationFixture,
  resolveFailedMigration,
  sourceSnapshot,
  sql,
} from './user-consolidation-migration-harness';

jest.setTimeout(120_000);
beforeAll(prepareMigrationFixture);
afterAll(cleanupMigrationFixture);

it.each(['FENCED', 'OPEN_COMMITTED'])(
  'refuses to refresh a protected generation with an inconsistent %s receipt',
  async (phase) => {
    await inMigrationDatabase(async (url) => {
      await forward(url);
      await sql(
        url,
        `SET oss_hub.user_consolidation_rollback='FENCED';\n${await artifact('rollback')}`,
      );
      await sql(
        url,
        `UPDATE user_consolidation_backup.control SET phase='${phase}'`,
      );
      const before = await sourceSnapshot(url);
      const evidence = await sql(
        url,
        `SELECT jsonb_build_object(
          'generation',(SELECT oid FROM pg_namespace WHERE nspname='user_consolidation_backup'),
          'source',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name,id)
            FROM user_consolidation_backup.source_rows t))`,
      );
      const migration = await readFile(
        join(process.cwd(), 'prisma/migrations', migrationId, 'migration.sql'),
        'utf8',
      );
      await expect(sql(url, migration)).rejects.toThrow(
        /backup is not available for replay/,
      );
      expect(await sourceSnapshot(url)).toBe(before);
      expect(
        await sql(
          url,
          `SELECT jsonb_build_object(
            'generation',(SELECT oid FROM pg_namespace WHERE nspname='user_consolidation_backup'),
            'source',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name,id)
              FROM user_consolidation_backup.source_rows t))`,
        ),
      ).toBe(evidence);
    });
  },
);

it('undoes generation rotation on a failed fresh forward and retries without losing old writes or attempts', async () => {
  await inMigrationDatabase(async (url) => {
    await forward(url);
    await sql(
      url,
      `SET oss_hub.user_consolidation_rollback='FENCED';\n${await artifact('rollback')}`,
    );
    await sql(
      url,
      `UPDATE "User" SET phone='01012345678' WHERE id='student-admin'`,
    );
    const latest = await sourceSnapshot(url);
    const generation = await sql(
      url,
      `SELECT oid FROM pg_namespace WHERE nspname='user_consolidation_backup'`,
    );
    const attempts = await sql(
      url,
      `SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM user_consolidation_backup.ledger_attempts t`,
    );
    const migration = await readFile(
      join(process.cwd(), 'prisma/migrations', migrationId, 'migration.sql'),
      'utf8',
    );
    await expect(
      forward(
        url,
        migration.replace(
          '-- checkpoint: snapshot',
          '-- checkpoint: snapshot\nSELECT 1/0;',
        ),
      ),
    ).rejects.toThrow(/current transaction is aborted/);
    expect(await sourceSnapshot(url)).toBe(latest);
    expect(
      await sql(
        url,
        `SELECT oid FROM pg_namespace WHERE nspname='user_consolidation_backup'`,
      ),
    ).toBe(generation);
    expect(
      await sql(
        url,
        `SELECT to_regnamespace('user_consolidation_backup_${generation}') IS NULL`,
      ),
    ).toBe('t');
    await resolveFailedMigration(url);
    const failedAttempt = await sql(
      url,
      `SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM _prisma_migrations t
        WHERE migration_name='${migrationId}'`,
    );
    await forward(url);
    await sql(url, await artifact('reconcile'));
    expect(
      await sql(
        url,
        `SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
          FROM user_consolidation_backup_${generation}.ledger_attempts t`,
      ),
    ).toBe(attempts);
    await sql(
      url,
      `SET oss_hub.user_consolidation_rollback='FENCED';\n${await artifact('rollback')}`,
    );
    expect(await sourceSnapshot(url)).toBe(latest);
    expect(
      await sql(
        url,
        `SELECT jsonb_agg(data ORDER BY id) FROM user_consolidation_backup.ledger_attempts
          WHERE data->>'finished_at' IS NULL`,
      ),
    ).toBe(failedAttempt);
  });
});
