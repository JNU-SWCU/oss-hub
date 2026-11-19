import { Client } from 'pg';
import type { Prisma } from '@prisma/client';
import { writeFile } from 'node:fs/promises';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  QueryRecordingPrisma,
  startQueryGrowthApp,
} from '../../test/query-growth';
import { CollectionUserActivityRepository } from '../github/collection-user-activity.repository';
import { PrismaService } from '../platform/prisma.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

it('serves a top-ten page without ledger queries and a median DB time below 100 ms at 113 students × 365 days', async () => {
  const prisma = new PrismaService();
  const recorder = new QueryRecordingPrisma();
  const planClient = new Client({ connectionString: process.env.DATABASE_URL });
  await planClient.connect();
  const recorded = new Map<string, string>();
  recorder.$on('query', (event: Prisma.QueryEvent) =>
    recorded.set(event.query, event.params),
  );
  const app = await startQueryGrowthApp(recorder);
  const collector = new CollectionUserActivityRepository(prisma);
  const measure = (year: string) =>
    recorder.record(async () => {
      const start = performance.now();
      const response = await fetch(
        app.baseUrl + '/api/v1/ranking?year=' + year + '&pageSize=10',
        { headers: { connection: 'close' } },
      );
      const body: unknown = await response.json();
      return {
        status: response.status,
        body,
        requestMs: performance.now() - start,
      };
    });
  const base = 8_912_654_000_000n;
  const students = Array.from({ length: 113 }, (_, i) => ({
    id: 'synthetic-ranking-scale-' + i,
    nickname: 'synthetic-scale-' + i,
    githubId: base + BigInt(i),
    type: 'STUDENT' as const,
  }));
  const ids = students.map((s) => s.githubId);
  try {
    await prisma.user.createMany({ data: students });
    const missing = await measure('2097');
    expect(missing.queries.count).toBe(3);
    expect(missing.result.status).toBe(200);
    expect(missing.result.body).toMatchObject({
      items: Array.from({ length: 10 }, () => ({ streak: null })),
    });
    expect(missing.queries.statements.join(' ')).not.toMatch(
      /github_user_activity_history/i,
    );
    const inserted = await prisma.$executeRaw`
      INSERT INTO github_user_activity_history (github_id, year, visibility, observed_at, commit_count)
      SELECT ${base}::bigint + student, 2025, 'PUBLIC',
        TIMESTAMPTZ '2025-01-01 00:00Z' + day * INTERVAL '1 day' + student * INTERVAL '1 second',
        1000000 + student + day
      FROM generate_series(0, 112) student CROSS JOIN generate_series(0, 364) day
    `;
    expect(inserted).toBe(113 * 365);
    const start = performance.now();
    await collector.refreshRankingSnapshots();
    const refreshed = performance.now();
    const samples = [];
    for (let i = 0; i < 7; i += 1) {
      const page = await measure('all');
      expect(page.result.status).toBe(200);
      expect(page.result.body).toMatchObject({
        items: Array.from({ length: 10 }, (_, i) => ({
          githubLogin: students[112 - i]?.nickname,
          rank: i + 1,
          total: 1000000 + 112 - i + 364,
          streak: { rankHeldSince: '2025-01-01' },
        })),
      });
      expect(page.queries.count).toBe(3);
      expect(page.queries.statements.join(' ')).not.toMatch(
        /github_user_activity_history/i,
      );
      let dbMs = 0;
      for (const statement of page.queries.statements) {
        const encoded = recorded.get(statement);
        if (!encoded) throw new Error('Missing query parameters');
        const params: unknown = JSON.parse(encoded);
        if (!Array.isArray(params))
          throw new Error('Expected query parameter array');
        const plan = await planClient.query<{
          'QUERY PLAN': { 'Planning Time': number; 'Execution Time': number }[];
        }>('EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) ' + statement, params);
        const metrics = plan.rows[0]?.['QUERY PLAN'][0];
        if (!metrics) throw new Error('Missing PostgreSQL timing');
        dbMs += metrics['Planning Time'] + metrics['Execution Time'];
      }
      samples.push({
        requestMs: page.result.requestMs,
        dbMs,
      });
    }
    const medianDbMs = samples
      .map((sample) => sample.dbMs)
      .sort((a, b) => a - b)[3];
    if (process.env.RANKING_SNAPSHOT_REPORT) {
      await writeFile(
        process.env.RANKING_SNAPSHOT_REPORT,
        JSON.stringify({
          inserted,
          samples,
          medianDbMs,
          precomputeMs: refreshed - start,
        }),
      );
    }
    expect(medianDbMs).toBeLessThan(100);
  } finally {
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: ids } } });
    await collector.refreshRankingSnapshots();
    await planClient.end();
    await app.close();
    await prisma.$disconnect();
  }
}, 120_000);
