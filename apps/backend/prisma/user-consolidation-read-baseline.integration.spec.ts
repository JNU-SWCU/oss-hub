import { PrismaClient, type Prisma } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { legacyRead } from './user-consolidation-legacy-read.fixture';
import {
  cleanupMigrationFixture,
  legacyDatabaseUrl,
  prepareLegacyFixture,
} from './user-consolidation-migration-harness';
import {
  CONSOLIDATION_PREFIX,
  consolidationId,
  withUserConsolidationFixture,
} from './user-consolidation-fixture';
import { readUserConsolidationSnapshot } from './user-consolidation-snapshot';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaClient({
  datasources: { db: { url: legacyDatabaseUrl } },
  log: [{ emit: 'event', level: 'query' }],
});
const queries: string[] = [];
prisma.$on('query', (event) => queries.push(event.query));
const read = legacyRead;
const history = legacyRead;

beforeAll(prepareLegacyFixture, 60_000);
afterAll(async () => {
  await prisma.$disconnect();
  await cleanupMigrationFixture();
});

it('records legacy source SQL counts and twenty sequential warm read samples', async () => {
  await withUserConsolidationFixture(prisma, async (transaction) => {
    const operations = [
      {
        name: 'legacy-source-user-list',
        run: () =>
          read.listAdminAccessUsers(transaction, {
            query: CONSOLIDATION_PREFIX,
            page: 1,
            limit: 20,
          }),
      },
      {
        name: 'legacy-source-user-detail',
        run: () =>
          read.findAdminAccessUserById(
            transaction,
            consolidationId('student-admin-staff'),
          ),
      },
      {
        name: 'legacy-source-request-history',
        run: () =>
          history.listAdminAccessStaffAccessRequestHistory(
            transaction,
            consolidationId('staff-rejected'),
            { page: 1, limit: 20 },
          ),
      },
    ];
    for (const operation of operations) {
      await operation.run();
      const samples = [];
      for (let index = 0; index < 20; index += 1) {
        const offset = queries.length;
        const start = performance.now();
        await operation.run();
        samples.push({
          milliseconds: performance.now() - start,
          sqlCount: queries.length - offset,
        });
      }
      const sorted = samples
        .map((sample) => sample.milliseconds)
        .sort((a, b) => a - b);
      console.info(
        'CONSOLIDATION_LEGACY_SOURCE_READ',
        JSON.stringify({
          name: operation.name,
          samples,
          medianMs: ((sorted[9] ?? 0) + (sorted[10] ?? 0)) / 2,
          p95Ms: sorted[18],
          surface:
            'legacy raw-SQL source contract, not current repository or performance proof',
        }),
      );
    }
    const page = await read.listAdminAccessUsers(transaction, {
      query: CONSOLIDATION_PREFIX,
      page: 1,
      limit: 200,
    });
    expect(page.total).toBe(162);
    expect(page.items).toHaveLength(162);
    const snapshot = await readUserConsolidationSnapshot(transaction);
    console.info(
      'CONSOLIDATION_SOURCE_ROWS',
      JSON.stringify({
        profiles: snapshot.profiles.filter(
          (row) => !row.userId.includes(':filler-'),
        ),
        requests: snapshot.requests,
        consents: snapshot.consents,
        audits: snapshot.audits,
      }),
    );
    const catalog = await transaction.$queryRaw<
      readonly { readonly inventory: Prisma.JsonValue }[]
    >`
      SELECT jsonb_build_object(
        'postgres', version(),
        'tables', (SELECT count(*) FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
        'finishedMigrations', (SELECT count(*) FROM "_prisma_migrations"
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
        'constraints', (SELECT jsonb_agg(jsonb_build_object(
          'table', c.conrelid::regclass::text, 'name', c.conname,
          'definition', pg_get_constraintdef(c.oid)) ORDER BY c.conname)
          FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname IN
            ('User', 'UserProfile', 'Consent', 'StaffAccessRequest', 'AuditLog')),
        'indexes', (SELECT jsonb_agg(jsonb_build_object(
          'table', tablename, 'name', indexname, 'definition', indexdef) ORDER BY indexname)
          FROM pg_indexes WHERE schemaname = 'public' AND tablename IN
            ('User', 'UserProfile', 'Consent', 'StaffAccessRequest', 'AuditLog')),
        'triggers', (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname)
          FROM pg_trigger t WHERE t.tgrelid = '"AuditLog"'::regclass AND NOT t.tgisinternal)
      ) AS inventory
    `;
    console.info('CONSOLIDATION_DATABASE_BASELINE', JSON.stringify(catalog));
  });
});
