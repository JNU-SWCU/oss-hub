import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { PrismaService } from '../src/prisma/prisma.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SCHEMA = 'user_profile_migration_fixture';
const prisma = new PrismaService();
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260731120000_add_user_profile_expand/migration.sql',
  ),
  'utf8',
);

type LegacyProfileRow = {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

async function inFixtureSchema<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${SCHEMA}"`);
    return operation(transaction);
  });
}

function migrationStatements(sql: string): readonly string[] {
  const withoutTransaction = sql
    .replace(/^BEGIN;\s*/, '')
    .replace(/\s*COMMIT;\s*$/, '');
  const doBlockEnd = withoutTransaction.indexOf('$$;');
  if (doBlockEnd === -1) {
    throw new Error('UserProfile migration preflight block is missing.');
  }
  const preflight = withoutTransaction.slice(0, doBlockEnd + 2).trim();
  const remaining = withoutTransaction.slice(doBlockEnd + 3);
  return [
    preflight,
    ...remaining
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  ];
}

async function executeMigration(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  for (const statement of migrationStatements(migration)) {
    await transaction.$executeRawUnsafe(statement);
  }
}

async function resetFixture(rows: readonly LegacyProfileRow[]): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
  await inFixtureSchema(async (transaction) => {
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "User" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT,
        "studentId" TEXT,
        "department" TEXT
      )
    `);
    for (const row of rows) {
      await transaction.$executeRaw`
        INSERT INTO "User" ("id", "name", "studentId", "department")
        VALUES (${row.id}, ${row.name}, ${row.studentId}, ${row.department})
      `;
    }
  });
}

async function readLegacyRows(): Promise<readonly LegacyProfileRow[]> {
  return inFixtureSchema(
    (transaction) =>
      transaction.$queryRaw<LegacyProfileRow[]>`
      SELECT "id", "name", "studentId", "department"
      FROM "User"
      ORDER BY "id"
    `,
  );
}

async function userProfileTableExists(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ readonly exists: boolean }>>`
    SELECT to_regclass(${`${SCHEMA}."UserProfile"`}) IS NOT NULL AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

it('완료 행만 이관하고 전체-null·이름-only 행에는 프로필을 만들지 않는다', async () => {
  // Given
  const completeStudentId = ['96', '00153201'].join('');
  await resetFixture([
    {
      id: 'complete',
      name: '합성 완료 사용자',
      studentId: completeStudentId,
      department: '인공지능학부',
    },
    { id: 'all-null', name: null, studentId: null, department: null },
    {
      id: 'name-only',
      name: 'Legacy GitHub Name',
      studentId: null,
      department: null,
    },
  ]);

  // When
  await inFixtureSchema(executeMigration);

  // Then
  await expect(
    inFixtureSchema(
      (transaction) =>
        transaction.$queryRaw<LegacyProfileRow[]>`
        SELECT "userId" AS "id", "name", "studentId", "department"
        FROM "UserProfile"
        ORDER BY "userId"
      `,
    ),
  ).resolves.toEqual([
    {
      id: 'complete',
      name: '합성 완료 사용자',
      studentId: completeStudentId,
      department: '인공지능학부',
    },
  ]);
});

it('astral Unicode 이름도 runtime profile policy와 같은 기준으로 이관한다', async () => {
  // Given
  const before = [
    {
      id: 'astral-complete',
      name: '😀'.repeat(51),
      studentId: '9600153204',
      department: '인공지능학부',
    },
  ] as const;
  await resetFixture(before);

  // When
  await inFixtureSchema(executeMigration);

  // Then
  await expect(
    inFixtureSchema(
      (transaction) =>
        transaction.$queryRaw<LegacyProfileRow[]>`
        SELECT "userId" AS "id", "name", "studentId", "department"
        FROM "UserProfile"
      `,
    ),
  ).resolves.toEqual(before);
});

it('불가능한 부분 조합은 DDL과 쓰기를 모두 롤백하고 legacy 데이터를 보존한다', async () => {
  // Given
  const before = [
    {
      id: 'invalid-partial',
      name: null,
      studentId: ['96', '00153202'].join(''),
      department: '인공지능학부',
    },
  ] as const;
  await resetFixture(before);

  // When
  const upgrade = inFixtureSchema(executeMigration);

  // Then
  await expect(upgrade).rejects.toThrow(/impossible partial profile/);
  await expect(readLegacyRows()).resolves.toEqual(before);
  await expect(userProfileTableExists()).resolves.toBe(false);
});

it('필드는 모두 있지만 정책에 맞지 않는 행은 DDL과 쓰기를 모두 롤백한다', async () => {
  // Given
  const before = [
    {
      id: 'invalid-complete',
      name: '합성 정책 위반 사용자',
      studentId: 'invalid-id',
      department: '인공지능학부',
    },
  ] as const;
  await resetFixture(before);

  // When
  const upgrade = inFixtureSchema(executeMigration);

  // Then
  await expect(upgrade).rejects.toThrow(/policy-invalid complete profile/);
  await expect(readLegacyRows()).resolves.toEqual(before);
  await expect(userProfileTableExists()).resolves.toBe(false);
});

it('중복 학번은 DDL과 쓰기를 모두 롤백하고 legacy 데이터를 보존한다', async () => {
  // Given
  const duplicateStudentId = ['96', '00153203'].join('');
  const before = [
    {
      id: 'duplicate-a',
      name: '합성 중복 사용자 A',
      studentId: duplicateStudentId,
      department: '인공지능학부',
    },
    {
      id: 'duplicate-b',
      name: '합성 중복 사용자 B',
      studentId: duplicateStudentId,
      department: '소프트웨어공학과',
    },
  ] as const;
  await resetFixture(before);

  // When
  const upgrade = inFixtureSchema(executeMigration);

  // Then
  await expect(upgrade).rejects.toMatchObject({
    code: 'P2010',
    meta: { code: '23505' },
  });
  await expect(readLegacyRows()).resolves.toEqual(before);
  await expect(userProfileTableExists()).resolves.toBe(false);
});
