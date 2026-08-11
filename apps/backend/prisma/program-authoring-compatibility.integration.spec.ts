import { PrismaService } from '../src/prisma/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  executeProgramAuthoringMigration,
  inProgramAuthoringFixtureSchema,
  resetProgramAuthoringFixture,
} from './program-authoring-migration-test-support';

// allow: SIZE_OK — legacy writes, explicit boundaries, and migration locking share one isolated trigger fixture.

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

jest.setTimeout(15_000);

const SCHEMA = 'program_authoring_compatibility_fixture';
const LEGACY_END_AT = new Date('9999-12-31T23:59:59.999Z');
const prisma = new PrismaService();

beforeEach(async () => {
  await resetProgramAuthoringFixture(prisma, SCHEMA);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

async function migrateFixture(): Promise<void> {
  await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    executeProgramAuthoringMigration,
  );
}

async function insertLegacyProgram(): Promise<void> {
  await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    (transaction) =>
      transaction.$executeRaw`
      INSERT INTO "Program" (
        "id", "applicationStartAt", "applicationEndAt", "endAt", "teamMinSize", "teamMaxSize"
      ) VALUES (
        'legacy-program',
        '2026-10-01T00:00:00.000Z',
        '2026-10-15T00:00:00.000Z',
        NULL,
        NULL,
        NULL
      )
    `,
  );
}

it('keeps a previous-image Program create writable with omitted start and nullable individual fields', async () => {
  await migrateFixture();

  await insertLegacyProgram();
});

it('keeps a previous-image Milestone create writable with an omitted start', async () => {
  await migrateFixture();
  await insertLegacyProgram();

  await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    (transaction) =>
      transaction.$executeRaw`
      INSERT INTO "Milestone" ("id", "programId", "dueAt")
      VALUES ('legacy-milestone', 'legacy-program', '2026-11-01T00:00:00.000Z')
    `,
  );

  await expect(
    inProgramAuthoringFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$queryRaw`
        SELECT "startAt", "endAt", "teamMinSize", "teamMaxSize"
        FROM "Program" WHERE "id" = 'legacy-program'
      `,
    ),
  ).resolves.toEqual([
    {
      startAt: new Date('2026-10-15T00:00:00.000Z'),
      endAt: LEGACY_END_AT,
      teamMinSize: 1,
      teamMaxSize: 1,
    },
  ]);
  await expect(
    inProgramAuthoringFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$queryRaw`
        SELECT "startAt", "dueAt" FROM "Milestone" WHERE "id" = 'legacy-milestone'
      `,
    ),
  ).resolves.toEqual([
    {
      startAt: new Date('2026-10-15T00:00:00.000Z'),
      dueAt: new Date('2026-11-01T00:00:00.000Z'),
    },
  ]);
});

it('normalizes an omitted Milestone start before its Program to one millisecond before dueAt', async () => {
  // Given
  await migrateFixture();

  // When
  await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    (transaction) =>
      transaction.$executeRaw`
    INSERT INTO "Milestone" ("id", "programId", "dueAt")
    VALUES ('early-legacy-milestone', 'program-1', '2026-08-10T00:00:00.000Z')
  `,
  );

  // Then
  const stored = await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    (transaction) =>
      transaction.$queryRaw`SELECT "startAt", "dueAt" FROM "Milestone" WHERE "id" = 'early-legacy-milestone'`,
  );
  expect(stored).toEqual([
    {
      startAt: new Date('2026-08-09T23:59:59.999Z'),
      dueAt: new Date('2026-08-10T00:00:00.000Z'),
    },
  ]);
});

it('rejects a Milestone create before its Program start', async () => {
  await migrateFixture();

  await expect(
    inProgramAuthoringFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$executeRaw`
        INSERT INTO "Milestone" ("id", "programId", "startAt", "dueAt")
        VALUES (
          'early-milestone', 'program-1',
          '2026-08-14T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
        )
      `,
    ),
  ).rejects.toBeDefined();

  await expect(
    inProgramAuthoringFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$queryRaw`
        SELECT "id" FROM "Milestone" WHERE "id" = 'early-milestone'
      `,
    ),
  ).resolves.toEqual([]);
});

it('accepts a Milestone create at its Program start', async () => {
  await migrateFixture();

  await expect(
    inProgramAuthoringFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$executeRaw`
        INSERT INTO "Milestone" ("id", "programId", "startAt", "dueAt")
        VALUES (
          'boundary-milestone', 'program-1',
          '2026-08-15T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
        )
      `,
    ),
  ).resolves.toBe(1);
});

it.each([
  ['at', '2026-09-01T00:00:00.000Z'],
  ['after', '2026-09-02T00:00:00.000Z'],
] as const)(
  'rejects a previous-image Milestone create %s its Program end',
  async (_boundary, dueAt) => {
    await migrateFixture();

    await expect(
      inProgramAuthoringFixtureSchema(
        prisma,
        SCHEMA,
        (transaction) =>
          transaction.$executeRaw`
          INSERT INTO "Milestone" ("id", "programId", "dueAt")
          VALUES ('invalid-legacy-milestone', 'program-1', ${dueAt}::timestamp)
        `,
      ),
    ).rejects.toBeDefined();

    await expect(
      inProgramAuthoringFixtureSchema(
        prisma,
        SCHEMA,
        (transaction) =>
          transaction.$queryRaw`
          SELECT "id" FROM "Milestone" WHERE "id" = 'invalid-legacy-milestone'
        `,
      ),
    ).resolves.toEqual([]);
  },
);

it('normalizes previous-image nullable Program updates without weakening stored nullability', async () => {
  await migrateFixture();

  await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    (transaction) =>
      transaction.$executeRaw`
      UPDATE "Program"
      SET "endAt" = NULL, "teamMinSize" = NULL, "teamMaxSize" = NULL
      WHERE "id" = 'program-1'
    `,
  );

  await expect(
    inProgramAuthoringFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$queryRaw`
        SELECT "endAt", "teamMinSize", "teamMaxSize"
        FROM "Program" WHERE "id" = 'program-1'
      `,
    ),
  ).resolves.toEqual([
    { endAt: LEGACY_END_AT, teamMinSize: 1, teamMaxSize: 1 },
  ]);
});

it('advances stored startAt when a previous-image Program update advances applicationEndAt without startAt', async () => {
  // Given
  await migrateFixture();

  // When
  await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    (transaction) =>
      transaction.$executeRaw`
      UPDATE "Program"
      SET "applicationEndAt" = '2026-08-20T00:00:00.000Z'
      WHERE "id" = 'program-1'
    `,
  );

  // Then
  const stored = await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    (transaction) =>
      transaction.$queryRaw<
        Array<{ readonly applicationEndAt: Date; readonly startAt: Date }>
      >`
      SELECT "applicationEndAt", "startAt"
      FROM "Program" WHERE "id" = 'program-1'
    `,
  );
  expect(stored).toEqual([
    {
      applicationEndAt: new Date('2026-08-20T00:00:00.000Z'),
      startAt: new Date('2026-08-20T00:00:00.000Z'),
    },
  ]);
});

it('preserves an explicit valid Program startAt when applicationEndAt advances', async () => {
  // Given
  await migrateFixture();

  // When
  await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    (transaction) =>
      transaction.$executeRaw`
      UPDATE "Program"
      SET
        "applicationEndAt" = '2026-08-20T00:00:00.000Z',
        "startAt" = '2026-08-25T00:00:00.000Z'
      WHERE "id" = 'program-1'
    `,
  );

  // Then
  const stored = await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    (transaction) =>
      transaction.$queryRaw<
        Array<{ readonly applicationEndAt: Date; readonly startAt: Date }>
      >`
      SELECT "applicationEndAt", "startAt"
      FROM "Program" WHERE "id" = 'program-1'
    `,
  );
  expect(stored).toEqual([
    {
      applicationEndAt: new Date('2026-08-20T00:00:00.000Z'),
      startAt: new Date('2026-08-25T00:00:00.000Z'),
    },
  ]);
});

it.each([
  ['reaches', '2026-09-01T00:00:00.000Z'],
  ['exceeds', '2026-09-02T00:00:00.000Z'],
] as const)(
  'rejects a previous-image Program applicationEndAt update that %s endAt after normalization',
  async (_boundary, applicationEndAt) => {
    // Given
    await migrateFixture();

    // When / Then
    await expect(
      inProgramAuthoringFixtureSchema(
        prisma,
        SCHEMA,
        (transaction) =>
          transaction.$executeRaw`
          UPDATE "Program"
          SET "applicationEndAt" = ${applicationEndAt}::timestamp
          WHERE "id" = 'program-1'
        `,
      ),
    ).rejects.toThrow('Program_operatingWindow_check');
  },
);

it('fails within the bounded lock timeout when a Program writer is active', async () => {
  let releaseWriter: (() => void) | undefined;
  let reportLocked: (() => void) | undefined;
  const writerLocked = new Promise<void>((resolve) => {
    reportLocked = resolve;
  });
  const writerRelease = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  const writer = prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe(
        `SET LOCAL search_path TO "${SCHEMA}"`,
      );
      await transaction.$executeRaw`UPDATE "Program" SET "teamMinSize" = 1 WHERE "id" = 'program-1'`;
      reportLocked?.();
      await writerRelease;
    },
    { timeout: 10_000 },
  );
  await writerLocked;

  const startedAt = Date.now();
  try {
    await expect(
      inProgramAuthoringFixtureSchema(
        prisma,
        SCHEMA,
        executeProgramAuthoringMigration,
      ),
    ).rejects.toBeDefined();
    expect(Date.now() - startedAt).toBeLessThan(2_500);
  } finally {
    releaseWriter?.();
    await writer;
  }
});
