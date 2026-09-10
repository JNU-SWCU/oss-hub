import { PrismaClient } from '@prisma/client';

import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:qa148:phone-migration:';
const USER_ID = `${TEST_PREFIX}user`;
const CONSTRAINT_NAME = 'User_phone_digits_check';

const prisma = new PrismaClient();

async function cleanFixtures(): Promise<void> {
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}

describe('QA148 canonical user phone migration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(cleanFixtures);

  afterEach(cleanFixtures);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('moves the nullable phone column to User and removes TeamMember.phone', async () => {
    // Given: every committed migration has been applied by the isolated runner.

    // When
    const columns = await prisma.$queryRaw<
      readonly {
        readonly tableName: string;
        readonly columnName: string;
        readonly isNullable: string;
      }[]
    >`
      SELECT
        table_name AS "tableName",
        column_name AS "columnName",
        is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('User', 'TeamMember')
        AND column_name = 'phone'
      ORDER BY table_name
    `;

    // Then
    expect(columns).toEqual([
      { tableName: 'User', columnName: 'phone', isNullable: 'YES' },
    ]);
  });

  it('keeps the canonical user phone constraint named and nullable', async () => {
    // Given: every committed migration has been applied by the isolated runner.

    // When
    const constraints = await prisma.$queryRaw<
      readonly {
        readonly constraintName: string;
        readonly constraintDefinition: string;
      }[]
    >`
      SELECT
        check_constraint.conname AS "constraintName",
        pg_get_constraintdef(check_constraint.oid) AS "constraintDefinition"
      FROM pg_constraint AS check_constraint
      JOIN pg_class AS relation ON relation.oid = check_constraint.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'User'
        AND check_constraint.conname = ${CONSTRAINT_NAME}
    `;

    // Then
    expect(constraints).toHaveLength(1);
    expect(constraints[0]?.constraintName).toBe(CONSTRAINT_NAME);
    expect(constraints[0]?.constraintDefinition).toBe(
      "CHECK (((phone IS NULL) OR (phone ~ '^[0-9]{10,11}$'::text)))",
    );
  });

  it.each([
    { label: 'ten digits', phone: '1'.repeat(10), expectedLength: 10 },
    { label: 'eleven digits', phone: '2'.repeat(11), expectedLength: 11 },
  ])(
    'persists a runtime-built $label value',
    async ({ phone, expectedLength }) => {
      // Given
      await prisma.$executeRaw`
      INSERT INTO "User" ("id", "githubId", "login", "phone", "createdAt", "updatedAt")
      VALUES (${USER_ID}, ${9_148_100_001}, ${`${TEST_PREFIX}valid`}, ${phone}, NOW(), NOW())
    `;

      // When
      const rows = await prisma.$queryRaw<
        readonly {
          readonly phoneLength: number;
          readonly hasOnlyDigits: boolean;
        }[]
      >`
      SELECT length("phone") AS "phoneLength", "phone" ~ '^[0-9]+$' AS "hasOnlyDigits"
      FROM "User"
      WHERE "id" = ${USER_ID}
    `;

      // Then
      expect(rows).toEqual([
        { phoneLength: expectedLength, hasOnlyDigits: true },
      ]);
    },
  );

  it('persists a null phone value', async () => {
    // Given
    await prisma.$executeRaw`
      INSERT INTO "User" ("id", "githubId", "login", "phone", "createdAt", "updatedAt")
      VALUES (${USER_ID}, ${9_148_100_002}, ${`${TEST_PREFIX}null`}, NULL, NOW(), NOW())
    `;

    // When
    const rows = await prisma.$queryRaw<
      readonly { readonly phoneIsNull: boolean }[]
    >`
      SELECT "phone" IS NULL AS "phoneIsNull"
      FROM "User"
      WHERE "id" = ${USER_ID}
    `;

    // Then
    expect(rows).toEqual([{ phoneIsNull: true }]);
  });

  it.each([
    { label: 'short', phone: '3'.repeat(9) },
    { label: 'long', phone: '4'.repeat(12) },
    { label: 'non-digit', phone: `${'5'.repeat(10)}X` },
  ])(
    'rejects a runtime-built $label value through the named check',
    async ({ phone }) => {
      // Given: the candidate value is built at runtime and is outside the contract.

      // When
      const insert = prisma.$executeRaw`
      INSERT INTO "User" ("id", "githubId", "login", "phone", "createdAt", "updatedAt")
      VALUES (${USER_ID}, ${9_148_100_003}, ${`${TEST_PREFIX}invalid`}, ${phone}, NOW(), NOW())
    `;

      // Then
      await expect(insert).rejects.toMatchObject({
        code: 'P2010',
        meta: { code: '23514' },
      });
    },
  );
});
