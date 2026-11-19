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

it('serves a top-ten page without ledger queries in under 100 ms at 113 students × 365 days', async () => {
  const prisma = new PrismaService();
  const recorder = new QueryRecordingPrisma();
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
    const page = await measure('all');
    const { requestMs } = page.result;
    if (process.env.RANKING_SNAPSHOT_REPORT) {
      await writeFile(
        process.env.RANKING_SNAPSHOT_REPORT,
        JSON.stringify({
          inserted,
          requestMs,
          precomputeMs: refreshed - start,
          queries: page.queries.count,
          dbMs: page.queries.durationMs,
        }),
      );
    }
    expect(page.result.status).toBe(200);
    expect(page.result.body).toMatchObject({
      items: Array.from({ length: 10 }, () => ({
        streak: { rankHeldSince: '2025-01-01' },
      })),
    });
    expect(missing.queries.count).toBe(3);
    expect(page.queries.count).toBe(missing.queries.count);
    expect(page.queries.statements.join(' ')).not.toMatch(
      /github_user_activity_history/i,
    );
    expect(requestMs).toBeLessThan(100);
  } finally {
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: ids } } });
    await collector.refreshRankingSnapshots();
    await app.close();
    await prisma.$disconnect();
  }
}, 120_000);
