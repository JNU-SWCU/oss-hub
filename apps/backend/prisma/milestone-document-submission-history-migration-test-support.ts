import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { migrationStatements } from './program-authoring-migration-test-support';

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    'migrations/20260827120000_add_milestone_document_submission_history/migration.sql',
  ),
  'utf8',
);

export function inSubmissionHistoryFixtureSchema<T>(
  prisma: PrismaService,
  schema: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    return operation(transaction);
  });
}

export async function executeSubmissionHistoryMigration(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  for (const statement of migrationStatements(MIGRATION)) {
    await transaction.$executeRawUnsafe(statement);
  }
}

export async function resetSubmissionHistoryFixture(
  prisma: PrismaService,
  schema: string,
  attachedFileCount: 1 | 2,
): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await inSubmissionHistoryFixtureSchema(
    prisma,
    schema,
    async (transaction) => {
      const schemaStatements = [
        `CREATE TYPE "MilestoneSubmissionType" AS ENUM ('FILE', 'TEXT')`,
        `CREATE TYPE "SubmissionFileLifecycle" AS ENUM ('PENDING', 'ATTACHED', 'DELETE_PENDING', 'DELETED')`,
        `CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED')`,
        `CREATE TABLE "User" ("id" TEXT PRIMARY KEY)`,
        `CREATE TABLE "Milestone" ("id" TEXT PRIMARY KEY, "submissionType" "MilestoneSubmissionType" NOT NULL)`,
        `CREATE TABLE "MilestoneDocumentSubmission" (
          "id" TEXT PRIMARY KEY,
          "content" JSONB,
          "submittedById" TEXT NOT NULL REFERENCES "User"("id"),
          "submittedAt" TIMESTAMP(3) NOT NULL,
          "revision" INTEGER NOT NULL
        )`,
        `CREATE TABLE "SubmissionFile" (
          "id" TEXT PRIMARY KEY,
          "milestoneDocumentSubmissionId" TEXT REFERENCES "MilestoneDocumentSubmission"("id"),
          "lifecycle" "SubmissionFileLifecycle" NOT NULL
        )`,
        `CREATE TABLE "MilestoneDocumentReviewHistory" (
          "id" TEXT PRIMARY KEY,
          "milestoneDocumentSubmissionId" TEXT NOT NULL REFERENCES "MilestoneDocumentSubmission"("id"),
          "reviewerId" TEXT NOT NULL REFERENCES "User"("id"),
          "decision" "ReviewDecision" NOT NULL,
          "comment" TEXT,
          "reviewedAt" TIMESTAMP(3) NOT NULL
        )`,
        `CREATE TABLE "Unrelated" ("id" TEXT PRIMARY KEY, "value" TEXT NOT NULL)`,
      ] as const;
      for (const statement of schemaStatements) {
        await transaction.$executeRawUnsafe(statement);
      }

      const fixtureStatements = [
        `INSERT INTO "User" VALUES ('actor-1')`,
        `INSERT INTO "Milestone" VALUES ('milestone-1', 'FILE')`,
        `INSERT INTO "MilestoneDocumentSubmission" VALUES
          ('submission-text', '{"type":"TEXT","text":"preserved text"}', 'actor-1', '2026-08-20T00:00:00.000Z', 1),
          ('submission-file', NULL, 'actor-1', '2026-08-21T00:00:00.000Z', 2)`,
        `INSERT INTO "MilestoneDocumentReviewHistory" VALUES
          ('review-1', 'submission-file', 'actor-1', 'CHANGES_REQUESTED', '표지를 고쳐 주세요.', '2026-08-22T00:00:00.000Z')`,
        `INSERT INTO "Unrelated" VALUES ('sentinel', 'preserved')`,
      ] as const;
      for (const statement of fixtureStatements) {
        await transaction.$executeRawUnsafe(statement);
      }
      const files = Array.from(
        { length: attachedFileCount },
        (_, index) => `('file-${index + 1}', 'submission-file', 'ATTACHED')`,
      ).join(',');
      await transaction.$executeRawUnsafe(
        `INSERT INTO "SubmissionFile" VALUES ${files}`,
      );
    },
  );
}

export async function columnIsNullable(
  prisma: PrismaService,
  schema: string,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ readonly nullable: boolean }>>`
    SELECT is_nullable = 'YES' AS nullable
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${table} AND column_name = ${column}
  `;
  return rows[0]?.nullable ?? false;
}

export async function relationExists(
  prisma: PrismaService,
  schema: string,
  relation: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ readonly exists: boolean }>>`
    SELECT to_regclass(${`${schema}."${relation}"`}) IS NOT NULL AS exists
  `;
  return rows[0]?.exists ?? false;
}
