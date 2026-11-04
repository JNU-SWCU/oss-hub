import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../src/platform/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  inProgramAuthoringFixtureSchema,
  migrationStatements,
  relationExists,
} from './program-authoring-migration-test-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const schema = 'team_history_prepare_fixture';
const migration = readFileSync(
  resolve(
    __dirname,
    'migrations/20261104140000_prepare_team_history/migration.sql',
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
      `CREATE TYPE "HistorySource" AS ENUM ('APPLICATION', 'BOOTSTRAP', 'MIGRATION')`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "ApplicationPreparation" (id TEXT PRIMARY KEY)`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "ApplicationPreparationParticipant" (id TEXT PRIMARY KEY)`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TABLE "TeamInvitation" (id TEXT PRIMARY KEY, status TEXT, "respondedAt" TIMESTAMP)`,
    );
    await tx.$executeRaw`INSERT INTO "TeamInvitation" VALUES ('pending', 'PENDING', NULL), ('finished', 'ACCEPTED', now())`;
  });
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

function prepare() {
  return within(async (tx) => {
    for (const statement of migrationStatements(migration))
      await tx.$executeRawUnsafe(statement);
  });
}

it('adds history without moving or deleting any existing invitation', async () => {
  await prepare();
  expect(await relationExists(prisma, schema, 'TeamHistory')).toBe(true);
  expect(await relationExists(prisma, schema, 'ApplicationPreparation')).toBe(
    true,
  );
  expect(
    await relationExists(prisma, schema, 'ApplicationPreparationParticipant'),
  ).toBe(true);
  await within(async (tx) => {
    await expect(
      tx.$queryRaw`SELECT id, status FROM "TeamInvitation" ORDER BY id`,
    ).resolves.toEqual([
      { id: 'finished', status: 'ACCEPTED' },
      { id: 'pending', status: 'PENDING' },
    ]);
    await expect(
      tx.$queryRaw`SELECT count(*)::int AS count FROM "TeamHistory"`,
    ).resolves.toEqual([{ count: 0 }]);
    await tx.$executeRaw`UPDATE "TeamInvitation" SET status = 'DECLINED', "respondedAt" = now() WHERE id = 'pending'`;
  });
});

it.each(['ApplicationPreparation', 'ApplicationPreparationParticipant'])(
  'fails without partial DDL if %s is not empty',
  async (table) => {
    await within((tx) =>
      tx.$executeRawUnsafe(`INSERT INTO "${table}" VALUES ('existing')`),
    );
    await expect(prepare()).rejects.toThrow('Preparation must be empty');
    expect(await relationExists(prisma, schema, 'TeamHistory')).toBe(false);
    await within(async (tx) => {
      await expect(
        tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${table}"`),
      ).resolves.toEqual([{ count: 1 }]);
    });
  },
);

it('rejects malformed event data at the database boundary', async () => {
  await prepare();
  await expect(
    within(
      (tx) => tx.$executeRaw`
    INSERT INTO "TeamHistory" (id, "teamId", "programId", event, source, data)
    VALUES ('bad', 'team', 'program', 'INVITATION_DECLINED', 'APPLICATION', '{}'::jsonb)
  `,
    ),
  ).rejects.toThrow('TeamHistory_invitation_data_check');
});
