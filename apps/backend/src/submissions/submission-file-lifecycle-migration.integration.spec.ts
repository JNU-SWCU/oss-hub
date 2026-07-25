import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SCHEMA = 'submission_file_migration_fixture';
const prisma = new PrismaService();
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260725121000_add_submission_file_lifecycle/migration.sql',
  ),
  'utf8',
);

async function inFixtureSchema<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${SCHEMA}"`);
    return operation(transaction);
  });
}
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let dollarTag: string | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    const character = sql[index]!;
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match?.[0]) {
        dollarTag = match[0];
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (character === ';') {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const trailing = sql.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

async function executeSql(
  transaction: Prisma.TransactionClient,
  sql: string,
): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    await transaction.$executeRawUnsafe(statement);
  }
}

describe('SubmissionFile lifecycle migration upgrade', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
    await inFixtureSchema(async (transaction) => {
      await executeSql(
        transaction,
        `
        CREATE TABLE "Program" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "Application" ("id" TEXT PRIMARY KEY, "programId" TEXT NOT NULL);
        CREATE TABLE "Milestone" ("id" TEXT PRIMARY KEY, "programId" TEXT NOT NULL);
        CREATE TABLE "Submission" (
          "id" TEXT PRIMARY KEY,
          "applicationId" TEXT NOT NULL,
          "milestoneId" TEXT NOT NULL
        );
        CREATE TABLE "SubmissionRevision" (
          "id" TEXT PRIMARY KEY,
          "submissionId" TEXT NOT NULL
        );
        CREATE TABLE "SubmissionFile" (
          "id" TEXT PRIMARY KEY,
          "submissionRevisionId" TEXT
        );
        INSERT INTO "Program" ("id") VALUES ('program');
        INSERT INTO "Application" ("id", "programId") VALUES ('application', 'program');
        INSERT INTO "Milestone" ("id", "programId") VALUES ('milestone', 'program');
        INSERT INTO "Submission" ("id", "applicationId", "milestoneId")
          VALUES ('submission-valid', 'application', 'milestone');
        INSERT INTO "SubmissionRevision" ("id", "submissionId")
          VALUES ('revision-valid', 'submission-valid');
        INSERT INTO "SubmissionFile" ("id", "submissionRevisionId")
          VALUES ('file-valid', 'revision-valid'), ('file-orphan', NULL);
        `,
      );
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  it('fails on orphan ownership, then succeeds after repair with nullable legacy expiry', async () => {
    await expect(
      inFixtureSchema((transaction) => executeSql(transaction, migration)),
    ).rejects.toThrow(/lifecycle backfill blocked/);

    await inFixtureSchema(async (transaction) => {
      await executeSql(
        transaction,
        `
        INSERT INTO "Submission" ("id", "applicationId", "milestoneId")
          VALUES ('submission-repaired', 'application', 'milestone');
        INSERT INTO "SubmissionRevision" ("id", "submissionId")
          VALUES ('revision-repaired', 'submission-repaired');
        UPDATE "SubmissionFile"
          SET "submissionRevisionId" = 'revision-repaired'
          WHERE "id" = 'file-orphan';
        `,
      );
      await executeSql(transaction, migration);
    });

    const rows = await inFixtureSchema((transaction) =>
      transaction.$queryRawUnsafe<
        Array<{
          id: string;
          applicationId: string;
          milestoneId: string;
          expiresAt: Date | null;
        }>
      >(
        `SELECT "id", "applicationId", "milestoneId", "expiresAt"
         FROM "SubmissionFile" ORDER BY "id"`,
      ),
    );
    expect(rows).toEqual([
      {
        id: 'file-orphan',
        applicationId: 'application',
        milestoneId: 'milestone',
        expiresAt: null,
      },
      {
        id: 'file-valid',
        applicationId: 'application',
        milestoneId: 'milestone',
        expiresAt: null,
      },
    ]);
  });

  it.each(['Application', 'Milestone'] as const)(
    'restricts deletion of a live %s parent',
    async (table) => {
      await expect(
        inFixtureSchema((transaction) =>
          transaction.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "id" = $1`,
            table === 'Application' ? 'application' : 'milestone',
          ),
        ),
      ).rejects.toThrow();
    },
  );
});
