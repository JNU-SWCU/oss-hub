import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../src/platform/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  inProgramAuthoringFixtureSchema,
  migrationStatements,
} from './program-authoring-migration-test-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const schema = 'program_organizers_array_fixture';
const migrationSql = readFileSync(
  resolve(
    __dirname,
    'migrations/20261116000000_program_organizers_array/migration.sql',
  ),
  'utf8',
);
const inFixture = <T>(
  operation: Parameters<typeof inProgramAuthoringFixtureSchema<T>>[2],
) => inProgramAuthoringFixtureSchema(prisma, schema, operation);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await inFixture(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `CREATE TABLE "Program" (id TEXT PRIMARY KEY, organizer TEXT NOT NULL)`,
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "Program" (id, organizer) VALUES
         ('program-team', 'OSS Hub 운영팀'),
         ('program-padded', '  SW 중심대학사업단  '),
         ('program-blank', '   ')`,
    );
  });
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

it('keeps each existing organizer as exactly one trimmed label and drops the old column', async () => {
  await inFixture(async (transaction) => {
    for (const statement of migrationStatements(migrationSql)) {
      await transaction.$executeRawUnsafe(statement);
    }
  });

  await expect(
    inFixture((transaction) =>
      transaction.$queryRawUnsafe<{ id: string; organizers: string[] }[]>(
        `SELECT id, "organizers" FROM "Program" ORDER BY id`,
      ),
    ),
  ).resolves.toEqual([
    { id: 'program-blank', organizers: [] },
    { id: 'program-padded', organizers: ['SW 중심대학사업단'] },
    { id: 'program-team', organizers: ['OSS Hub 운영팀'] },
  ]);
  await expect(
    prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = '${schema}' AND table_name = 'Program'
       ORDER BY column_name`,
    ),
  ).resolves.toEqual([{ column_name: 'id' }, { column_name: 'organizers' }]);
});
