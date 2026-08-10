import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';

export type ProgramAuthoringFixture = {
  readonly applicationEndAt: string;
  readonly endAt: string | null;
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly milestoneDueAt: string;
};

export const VALID_PROGRAM_AUTHORING_FIXTURE: ProgramAuthoringFixture = {
  applicationEndAt: '2026-08-15T00:00:00.000Z',
  endAt: '2026-09-01T00:00:00.000Z',
  teamMinSize: null,
  teamMaxSize: null,
  milestoneDueAt: '2026-08-20T00:00:00.000Z',
};

export const PROGRAM_AUTHORING_MIGRATION = readFileSync(
  resolve(
    __dirname,
    'migrations/20260810120000_add_program_authoring_foundation/migration.sql',
  ),
  'utf8',
);

export function migrationStatements(sql: string): readonly string[] {
  const body = sql.replace(/^BEGIN;\s*/, '').replace(/\s*COMMIT;\s*$/, '');
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let dollarTag: string | null = null;

  for (let index = 0; index < body.length; index += 1) {
    if (dollarTag !== null) {
      if (body.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }

    const character = body[index];
    if (quote !== null) {
      if (character === quote && body[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '$') {
      const tag = body
        .slice(index)
        .match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag !== undefined) {
        dollarTag = tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (character === ';') {
      const statement = body.slice(start, index).trim();
      if (statement.length > 0) statements.push(statement);
      start = index + 1;
    }
  }

  const finalStatement = body.slice(start).trim();
  if (finalStatement.length > 0) statements.push(finalStatement);
  return statements;
}

export function inProgramAuthoringFixtureSchema<T>(
  prisma: PrismaService,
  schema: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    return operation(transaction);
  });
}

export async function executeProgramAuthoringMigration(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  for (const statement of migrationStatements(PROGRAM_AUTHORING_MIGRATION)) {
    await transaction.$executeRawUnsafe(statement);
  }
}

export async function resetProgramAuthoringFixture(
  prisma: PrismaService,
  schema: string,
  fixture: ProgramAuthoringFixture = VALID_PROGRAM_AUTHORING_FIXTURE,
): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await inProgramAuthoringFixtureSchema(prisma, schema, async (transaction) => {
    await transaction.$executeRawUnsafe(
      'CREATE TABLE "User" ("id" TEXT PRIMARY KEY)',
    );
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Program" (
        "id" TEXT PRIMARY KEY,
        "applicationStartAt" TIMESTAMP(3) NOT NULL,
        "applicationEndAt" TIMESTAMP(3) NOT NULL,
        "endAt" TIMESTAMP(3),
        "teamMinSize" INTEGER,
        "teamMaxSize" INTEGER
      )
    `);
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "Milestone" (
        "id" TEXT PRIMARY KEY,
        "programId" TEXT NOT NULL REFERENCES "Program"("id"),
        "dueAt" TIMESTAMP(3) NOT NULL
      )
    `);
    await transaction.$executeRawUnsafe(
      'CREATE TABLE "Unrelated" ("id" TEXT PRIMARY KEY, "value" TEXT NOT NULL)',
    );
    await transaction.$executeRaw`INSERT INTO "User" ("id") VALUES ('actor-1'), ('actor-2')`;
    await transaction.$executeRaw`
      INSERT INTO "Program" (
        "id", "applicationStartAt", "applicationEndAt", "endAt", "teamMinSize", "teamMaxSize"
      ) VALUES (
        'program-1', '2026-08-01T00:00:00.000Z', ${fixture.applicationEndAt}::timestamp,
        ${fixture.endAt}::timestamp, ${fixture.teamMinSize}, ${fixture.teamMaxSize}
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "Milestone" ("id", "programId", "dueAt")
      VALUES ('milestone-1', 'program-1', ${fixture.milestoneDueAt}::timestamp)
    `;
    await transaction.$executeRaw`
      INSERT INTO "Unrelated" ("id", "value") VALUES ('sentinel', 'preserved')
    `;
  });
}

export async function relationExists(
  prisma: PrismaService,
  schema: string,
  name: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ readonly exists: boolean }>>`
    SELECT to_regclass(${`${schema}."${name}"`}) IS NOT NULL AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

export async function columnExists(
  prisma: PrismaService,
  schema: string,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ readonly exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = ${table} AND column_name = ${column}
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}
