import { PrismaService } from '../src/prisma/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  columnExists,
  executeProgramAuthoringMigration,
  inProgramAuthoringFixtureSchema,
  relationExists,
  resetProgramAuthoringFixture,
  type ProgramAuthoringFixture,
  VALID_PROGRAM_AUTHORING_FIXTURE,
} from './program-authoring-migration-test-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SCHEMA = 'program_authoring_migration_fixture';
const prisma = new PrismaService();

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

it('upgrades valid rows, preserves unrelated data, and creates both authoring foundations', async () => {
  await resetProgramAuthoringFixture(
    prisma,
    SCHEMA,
    VALID_PROGRAM_AUTHORING_FIXTURE,
  );

  await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    executeProgramAuthoringMigration,
  );

  await expect(
    inProgramAuthoringFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$queryRaw`
        SELECT "startAt", "endAt", "teamMinSize", "teamMaxSize" FROM "Program"
      `,
    ),
  ).resolves.toEqual([
    {
      startAt: new Date(VALID_PROGRAM_AUTHORING_FIXTURE.applicationEndAt),
      endAt: new Date(VALID_PROGRAM_AUTHORING_FIXTURE.endAt ?? ''),
      teamMinSize: 1,
      teamMaxSize: 1,
    },
  ]);
  await expect(
    relationExists(prisma, SCHEMA, 'ProgramAuthoringUpload'),
  ).resolves.toBe(true);
  await expect(
    relationExists(prisma, SCHEMA, 'ProgramCreateRequest'),
  ).resolves.toBe(true);
  await expect(
    inProgramAuthoringFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$queryRaw`SELECT "value" FROM "Unrelated" WHERE "id" = 'sentinel'`,
    ),
  ).resolves.toEqual([{ value: 'preserved' }]);
});

it.each([
  [
    'Program schedule',
    {
      ...VALID_PROGRAM_AUTHORING_FIXTURE,
      endAt: VALID_PROGRAM_AUTHORING_FIXTURE.applicationEndAt,
    },
  ],
  [
    'Program team range',
    { ...VALID_PROGRAM_AUTHORING_FIXTURE, teamMinSize: 4, teamMaxSize: 2 },
  ],
  [
    'Milestone schedule',
    {
      ...VALID_PROGRAM_AUTHORING_FIXTURE,
      milestoneDueAt: VALID_PROGRAM_AUTHORING_FIXTURE.applicationEndAt,
    },
  ],
  [
    'Milestone after Program',
    {
      ...VALID_PROGRAM_AUTHORING_FIXTURE,
      milestoneDueAt: '2026-09-02T00:00:00.000Z',
    },
  ],
  [
    'Milestone at Program end',
    {
      ...VALID_PROGRAM_AUTHORING_FIXTURE,
      milestoneDueAt: '2026-09-01T00:00:00.000Z',
    },
  ],
] as const satisfies readonly (readonly [string, ProgramAuthoringFixture])[])(
  'aborts %s fixtures before any schema or data change',
  async (_case, fixture) => {
    await resetProgramAuthoringFixture(prisma, SCHEMA, fixture);

    await expect(
      inProgramAuthoringFixtureSchema(
        prisma,
        SCHEMA,
        executeProgramAuthoringMigration,
      ),
    ).rejects.toBeDefined();

    await expect(
      columnExists(prisma, SCHEMA, 'Program', 'startAt'),
    ).resolves.toBe(false);
    await expect(
      relationExists(prisma, SCHEMA, 'ProgramAuthoringUpload'),
    ).resolves.toBe(false);
    await expect(
      inProgramAuthoringFixtureSchema(
        prisma,
        SCHEMA,
        (transaction) =>
          transaction.$queryRaw`SELECT "value" FROM "Unrelated" WHERE "id" = 'sentinel'`,
      ),
    ).resolves.toEqual([{ value: 'preserved' }]);
  },
);
