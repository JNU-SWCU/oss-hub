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
const schema = 'invitation_archive_prepare_fixture';
const sql = readFileSync(
  resolve(
    __dirname,
    'migrations/20261104180000_prepare_invitation_archival/migration.sql',
  ),
  'utf8',
);
const within = <T>(
  operation: Parameters<typeof inProgramAuthoringFixtureSchema<T>>[2],
) => inProgramAuthoringFixtureSchema(prisma, schema, operation);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await within(async (tx) => {
    await tx.$executeRawUnsafe(
      `CREATE TYPE "TeamHistoryEvent" AS ENUM ('INVITATION_ACCEPTED', 'INVITATION_DECLINED', 'INVITATION_CANCELLED')`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "ApplicationPreparation" (id TEXT PRIMARY KEY)`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "ApplicationPreparationParticipant" (id TEXT PRIMARY KEY)`,
    );
  });
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

function apply() {
  return within(async (tx) => {
    for (const statement of migrationStatements(sql))
      await tx.$executeRawUnsafe(statement);
  });
}

it('permits the archive event after the empty-state boundary', async () => {
  await apply();
  await within(async (tx) => {
    await expect(
      tx.$queryRaw`SELECT 'INVITATION_ARCHIVED'::"TeamHistoryEvent"::text AS event`,
    ).resolves.toEqual([{ event: 'INVITATION_ARCHIVED' }]);
    await expect(
      tx.$queryRaw`SELECT count(*)::int AS count FROM "ApplicationPreparation"`,
    ).resolves.toEqual([{ count: 0 }]);
  });
  await expect(apply()).resolves.toBeUndefined();
});

it.each(['ApplicationPreparation', 'ApplicationPreparationParticipant'])(
  'rejects late insertion into retired %s',
  async (table) => {
    await apply();
    await expect(
      within((tx) =>
        tx.$executeRawUnsafe(`INSERT INTO "${table}" VALUES ('late')`),
      ),
    ).rejects.toThrow(`${table}_retired`);
    await within(async (tx) => {
      await expect(
        tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${table}"`),
      ).resolves.toEqual([{ count: 0 }]);
    });
  },
);

it.each(['ApplicationPreparation', 'ApplicationPreparationParticipant'])(
  'refuses reader retirement while %s contains data',
  async (table) => {
    await within((tx) =>
      tx.$executeRawUnsafe(`INSERT INTO "${table}" VALUES ('retained')`),
    );
    await expect(apply()).rejects.toThrow('Preparation must be empty');
    await within(async (tx) => {
      await expect(
        tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${table}"`),
      ).resolves.toEqual([{ count: 1 }]);
    });
    await expect(
      within(
        (tx) => tx.$queryRaw`SELECT 'INVITATION_ARCHIVED'::"TeamHistoryEvent"`,
      ),
    ).rejects.toThrow('INVITATION_ARCHIVED');
  },
);
