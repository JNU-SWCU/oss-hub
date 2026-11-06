import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../src/platform/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  columnExists,
  inProgramAuthoringFixtureSchema,
  migrationStatements,
} from './program-authoring-migration-test-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const schema = 'team_repository_url_drop_fixture';
const dropSql = readFileSync(
  resolve(
    __dirname,
    'migrations/20261106230000_drop_team_repository_url/migration.sql',
  ),
  'utf8',
);
const inFixture = <T>(
  operation: Parameters<typeof inProgramAuthoringFixtureSchema<T>>[2],
) => inProgramAuthoringFixtureSchema(prisma, schema, operation);
const apply = () =>
  inFixture(async (transaction) => {
    for (const statement of migrationStatements(dropSql)) {
      await transaction.$executeRawUnsafe(statement);
    }
  });
const givenTeams = (linkedCount: number) =>
  inFixture((transaction) =>
    transaction.$executeRawUnsafe(
      `INSERT INTO "Team" (id, "repositoryUrl")
       SELECT 'team-' || n, CASE WHEN n <= ${linkedCount}
         THEN 'https://github.com/synthetic/repository-' || n END
       FROM generate_series(1, 5) AS n`,
    ),
  );
const repositoryUrlExists = () =>
  columnExists(prisma, schema, 'Team', 'repositoryUrl');

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await inFixture((transaction) =>
    transaction.$executeRawUnsafe(
      `CREATE TABLE "Team" (id TEXT PRIMARY KEY, "repositoryUrl" TEXT)`,
    ),
  );
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

it.each([0, 2, 3])(
  'drops Team.repositoryUrl and keeps every team when %i teams hold a value',
  async (linkedCount) => {
    await givenTeams(linkedCount);

    await apply();

    await expect(repositoryUrlExists()).resolves.toBe(false);
    await expect(
      inFixture((transaction) =>
        transaction.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT count(*) AS count FROM "Team"`,
        ),
      ),
    ).resolves.toEqual([{ count: 5n }]);
  },
);

it.each([4, 5])(
  'aborts and keeps Team.repositoryUrl when %i teams hold a value, more than 3',
  async (linkedCount) => {
    await givenTeams(linkedCount);

    await expect(apply()).rejects.toThrow(
      `Team.repositoryUrl drop blocked: non-null=${linkedCount}, expected at most 3`,
    );
    await expect(repositoryUrlExists()).resolves.toBe(true);
  },
);

it('aborts when Team.repositoryUrl is already gone', async () => {
  await inFixture((transaction) =>
    transaction.$executeRawUnsafe(
      `ALTER TABLE "Team" DROP COLUMN "repositoryUrl"`,
    ),
  );

  await expect(apply()).rejects.toThrow(
    'Team.repositoryUrl drop blocked: column is missing',
  );
});
