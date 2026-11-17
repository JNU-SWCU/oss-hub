import { assertIsolatedIntegrationDatabase } from './integration-database.guard';
import {
  removeQueryGrowthWorld,
  seedQueryGrowthWorld,
  type QueryGrowthWorld,
} from './query-growth.fixture';
import {
  QueryRecordingPrisma,
  startQueryGrowthApp,
  type QueryGrowthApp,
} from './query-growth';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const PREFIX = 'staff-dashboard-scale';
const RECRUITING = 125;
const ENDED = 100;
const prisma = new QueryRecordingPrisma();
let world: QueryGrowthWorld;
let app: QueryGrowthApp;

interface SummaryBody {
  readonly programs: readonly { readonly id: string }[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly catalogTotal: number;
}

async function summary(query: string) {
  const response = await fetch(
    `${app.baseUrl}/api/v1/dashboard/staff/summary?${query}`,
    {
      headers: {
        connection: 'close',
        cookie: await app.sessionCookie(world.staffGithubId),
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  return {
    status: response.status,
    body: (await response.json()) as SummaryBody,
  };
}

beforeAll(async () => {
  await prisma.$connect();
  await removeQueryGrowthWorld(prisma);
  await prisma.program.deleteMany({ where: { id: { startsWith: PREFIX } } });
  const now = new Date();
  world = await seedQueryGrowthWorld(prisma, 1, now);
  await prisma.program.createMany({
    data: Array.from({ length: RECRUITING + ENDED }, (_, index) => {
      const ended = index >= RECRUITING;
      return {
        id: `${PREFIX}-${String(index).padStart(3, '0')}`,
        name: `${PREFIX} ${String(index).padStart(3, '0')}`,
        organizers: ['Synthetic integration fixture'],
        category: 'BASIC' as const,
        trackType: 'CURRICULAR' as const,
        applicationTemplateKey: 'capstone-v1',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date(now.getTime() - (ended ? 90 : 1) * DAY_MS),
        applicationEndAt: new Date(now.getTime() + (ended ? -80 : 10) * DAY_MS),
        startAt: new Date(now.getTime() - (ended ? 70 : 0) * DAY_MS),
        endAt: new Date(now.getTime() + (ended ? -1 : 60) * DAY_MS),
        teamMinSize: 1,
        teamMaxSize: 5,
        description: 'Synthetic staff dashboard scale fixture',
      };
    }),
  });
  app = await startQueryGrowthApp(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.program.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await removeQueryGrowthWorld(prisma);
  await prisma.$disconnect();
});

it('answers with one page and correct totals when there are more than 200 programs', async () => {
  const catalogTotal = await prisma.program.count({
    where: { lifecycle: { not: 'DELETED' } },
  });
  expect(catalogTotal).toBeGreaterThan(200);

  const all = await summary('');
  expect(all.status).toBe(200);
  expect(all.body).toMatchObject({
    page: 1,
    pageSize: 20,
    total: catalogTotal,
    catalogTotal,
  });
  expect(all.body.programs).toHaveLength(20);

  const scoped = await summary(`search=${PREFIX}&pageSize=50&page=3`);
  expect(scoped.status).toBe(200);
  expect(scoped.body).toMatchObject({ page: 3, total: RECRUITING + ENDED });
  expect(scoped.body.programs).toHaveLength(50);

  const ended = await summary(
    `search=${PREFIX}&status=ended&pageSize=50&page=9`,
  );
  expect(ended.status).toBe(200);
  expect(ended.body).toMatchObject({ page: 2, total: ENDED });
  expect(ended.body.programs).toHaveLength(50);
  expect(
    ended.body.programs.every(
      (program) => Number(program.id.slice(-3)) >= RECRUITING,
    ),
  ).toBe(true);
});
