import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

it('backfills existing daily observations at migrate deploy, before any collection', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ranking_backfill_fixture;
      SET search_path TO ranking_backfill_fixture;
      CREATE TABLE "User" AS SELECT "githubId", login, type FROM public."User" WITH NO DATA;
      CREATE TABLE github_user_activity_history (LIKE public.github_user_activity_history INCLUDING DEFAULTS);
      INSERT INTO "User" VALUES (1, 'synthetic-leader', 'STUDENT');
      INSERT INTO github_user_activity_history (github_id, year, visibility, observed_at, commit_count) VALUES
        (1, 2025, 'PUBLIC', '2025-01-01 14:59Z', 4), (1, 2025, 'PUBLIC', '2025-01-01 15:00Z', 5);`);
    await client.query(
      await readFile(
        resolve(
          __dirname,
          'migrations/20261119040000_add_ranking_snapshot/migration.sql',
        ),
        'utf8',
      ),
    );
    expect(
      (
        await client.query(
          'SELECT current_row, commit_count FROM ranking_activity_snapshot ORDER BY current_row',
        )
      ).rows,
    ).toEqual([
      { current_row: false, commit_count: 4 },
      { current_row: true, commit_count: 5 },
    ]);
    expect(
      (
        await client.query(
          'SELECT period, rank_held_since::text, top_ten_since::text FROM ranking_streak_snapshot ORDER BY period',
        )
      ).rows,
    ).toEqual([
      { period: 0, rank_held_since: '2025-01-01', top_ten_since: '2025-01-01' },
      {
        period: 2025,
        rank_held_since: '2025-01-01',
        top_ten_since: '2025-01-01',
      },
    ]);
  } finally {
    await client.query(
      'ROLLBACK; DROP SCHEMA IF EXISTS ranking_backfill_fixture CASCADE',
    );
    await client.end();
  }
});
