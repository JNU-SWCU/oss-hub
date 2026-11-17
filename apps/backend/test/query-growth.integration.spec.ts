import { writeFile } from 'node:fs/promises';
import { assertIsolatedIntegrationDatabase } from './integration-database.guard';
import {
  countQueryGrowthRows,
  removeQueryGrowthWorld,
  seedQueryGrowthWorld,
  type QueryGrowthWorld,
} from './query-growth.fixture';
import {
  at,
  measureEndpoint,
  QueryRecordingPrisma,
  startQueryGrowthApp,
  type EndpointMeasurement,
} from './query-growth';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SCALES = [1, 10] as const;
const REPEATS = 3;

type Viewer = 'anonymous' | 'staff' | 'student';

interface Endpoint {
  readonly name: string;
  readonly viewer: Viewer;
  readonly path: (world: QueryGrowthWorld) => string;
}

const ENDPOINTS: readonly Endpoint[] = [
  {
    name: 'GET /ranking',
    viewer: 'anonymous',
    path: (world) => `/api/v1/ranking?year=${world.year}&pageSize=100`,
  },
  {
    name: 'GET /ranking',
    viewer: 'staff',
    path: (world) => `/api/v1/ranking?year=${world.year}&pageSize=100`,
  },
  {
    name: 'GET /ranking/years',
    viewer: 'anonymous',
    path: () => '/api/v1/ranking/years',
  },
  {
    name: 'GET /ranking/timeline',
    viewer: 'anonymous',
    path: (world) => `/api/v1/ranking/timeline?year=${world.year}`,
  },
  {
    name: 'GET /dashboard/staff/insights',
    viewer: 'staff',
    path: (world) => `/api/v1/dashboard/staff/insights?year=${world.year}`,
  },
  {
    name: 'GET /dashboard/staff/insights?year=all',
    viewer: 'staff',
    path: () => '/api/v1/dashboard/staff/insights?year=all',
  },
  {
    name: 'GET /programs',
    viewer: 'anonymous',
    path: () => '/api/v1/programs?pageSize=100',
  },
  {
    name: 'GET /programs',
    viewer: 'staff',
    path: () => '/api/v1/programs?pageSize=100',
  },
  {
    name: 'GET /programs',
    viewer: 'student',
    path: () => '/api/v1/programs?pageSize=100',
  },
  {
    name: 'GET /programs/:id',
    viewer: 'anonymous',
    path: (world) => `/api/v1/programs/${world.targetProgramId}`,
  },
  {
    name: 'GET /programs/:id/viewer',
    viewer: 'staff',
    path: (world) => `/api/v1/programs/${world.targetProgramId}/viewer`,
  },
  {
    name: 'GET /programs/:id/viewer',
    viewer: 'student',
    path: (world) => `/api/v1/programs/${world.targetProgramId}/viewer`,
  },
  {
    name: 'GET /programs/:programId/overview',
    viewer: 'staff',
    path: (world) => `/api/v1/programs/${world.targetProgramId}/overview`,
  },
  {
    name: 'GET /programs/:programId/overview/teams',
    viewer: 'staff',
    path: (world) => `/api/v1/programs/${world.targetProgramId}/overview/teams`,
  },
  {
    name: 'GET /programs/:programId/teams',
    viewer: 'staff',
    path: (world) =>
      `/api/v1/programs/${world.targetProgramId}/teams?pageSize=100`,
  },
  {
    name: 'GET /programs/:programId/teams?view=team-management',
    viewer: 'staff',
    path: (world) =>
      `/api/v1/programs/${world.targetProgramId}/teams?pageSize=100&view=team-management`,
  },
  {
    name: 'GET /programs/:programId/teams/:teamId',
    viewer: 'staff',
    path: (world) =>
      `/api/v1/programs/${world.targetProgramId}/teams/${world.targetTeamId}`,
  },
  {
    name: 'GET /programs/:programId/submissions/matrix',
    viewer: 'staff',
    path: (world) =>
      `/api/v1/programs/${world.targetProgramId}/submissions/matrix?pageSize=100`,
  },
  {
    name: 'GET /projects',
    viewer: 'anonymous',
    path: () => '/api/v1/projects?pageSize=50',
  },
  {
    name: 'GET /projects/:projectId',
    viewer: 'anonymous',
    path: (world) => `/api/v1/projects/${world.targetProjectId}`,
  },
  {
    name: 'GET /users/:userId/public-profile',
    viewer: 'anonymous',
    path: (world) => `/api/v1/users/${world.profileUserId}/public-profile`,
  },
];

interface ScaleResult {
  readonly rows: Record<string, number>;
  readonly endpoints: readonly (readonly EndpointMeasurement[])[];
}

const prisma = new QueryRecordingPrisma();

function viewerGithubId(
  world: QueryGrowthWorld,
  viewer: Viewer,
): bigint | null {
  if (viewer === 'staff') return world.staffGithubId;
  if (viewer === 'student') return world.studentGithubId;
  return null;
}

async function measureScale(scale: number): Promise<ScaleResult> {
  await removeQueryGrowthWorld(prisma);
  const world = await seedQueryGrowthWorld(prisma, scale, new Date());
  const rows = await countQueryGrowthRows(prisma, world);
  const app = await startQueryGrowthApp(prisma);
  try {
    const idle = await prisma.record(() => Promise.resolve());
    expect(idle.queries.count).toBe(0);
    const endpoints: EndpointMeasurement[][] = [];
    for (const endpoint of ENDPOINTS) {
      const samples: EndpointMeasurement[] = [];
      for (let repeat = 0; repeat < REPEATS; repeat += 1) {
        samples.push(
          await measureEndpoint(
            prisma,
            app,
            endpoint.path(world),
            viewerGithubId(world, endpoint.viewer),
          ),
        );
      }
      endpoints.push(samples);
    }
    return { rows, endpoints };
  } finally {
    await app.close();
  }
}

const median = (values: readonly number[]) =>
  at(
    [...values].sort((left, right) => left - right),
    Math.floor(values.length / 2),
  );

afterAll(async () => {
  await removeQueryGrowthWorld(prisma);
  await prisma.$disconnect();
});

it('keeps per-request Prisma query counts equal at 1x and 10x synthetic data', async () => {
  await prisma.$connect();
  const [small, large] = [
    await measureScale(SCALES[0]),
    await measureScale(SCALES[1]),
  ];

  for (const [relation, count] of Object.entries(small.rows)) {
    expect({ relation, count: count > 0 }).toEqual({ relation, count: true });
    expect({
      relation,
      tenfold: (large.rows[relation] ?? 0) >= count * 10,
    }).toEqual({
      relation,
      tenfold: true,
    });
  }

  const report = ENDPOINTS.map((endpoint, index) => {
    const result = { endpoint: `${endpoint.name} (${endpoint.viewer})` };
    const scales = [small, large].map((scale) => {
      const samples = at(scale.endpoints, index);
      expect({
        ...result,
        statuses: samples.map((sample) => sample.status),
      }).toEqual({ ...result, statuses: [200, 200, 200] });
      expect({
        ...result,
        nonEmpty: samples.every((sample) => sample.itemCount > 0),
      }).toEqual({ ...result, nonEmpty: true });
      const counts = new Set(samples.map((sample) => sample.queries));
      expect({ ...result, stableCounts: counts.size }).toEqual({
        ...result,
        stableCounts: 1,
      });
      return {
        queries: at(samples, 0).queries,
        items: at(samples, 0).itemCount,
        dbMs: Number(
          median(samples.map((sample) => sample.durationMs)).toFixed(1),
        ),
        statements: at(samples, 0).statements,
      };
    });
    return {
      ...result,
      viewer: endpoint.viewer,
      oneX: at(scales, 0),
      tenX: at(scales, 1),
      growing: at(scales, 1).queries > at(scales, 0).queries,
    };
  });

  const reportPath = process.env.QUERY_GROWTH_REPORT;
  if (reportPath !== undefined && reportPath !== '') {
    await writeFile(
      reportPath,
      JSON.stringify(
        { rows: { oneX: small.rows, tenX: large.rows }, report },
        null,
        2,
      ),
    );
  }

  expect(
    report
      .filter((row) => row.oneX.queries !== row.tenX.queries)
      .map(
        (row) => `${row.endpoint}: ${row.oneX.queries} -> ${row.tenX.queries}`,
      ),
  ).toEqual([]);
}, 600_000);
