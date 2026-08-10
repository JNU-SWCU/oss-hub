import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { migrationStatements } from './program-authoring-migration-test-support';

export const REPOSITORY_RELEASE_REMOVAL_MIGRATION_NAME =
  '20260810130000_remove_repository_release_submissions';

const migration = readFileSync(
  resolve(
    __dirname,
    `migrations/${REPOSITORY_RELEASE_REMOVAL_MIGRATION_NAME}/migration.sql`,
  ),
  'utf8',
);

export type ReleaseRemovalSnapshot = {
  readonly programCount: bigint;
  readonly applicationCount: bigint;
  readonly teamCount: bigint;
  readonly repositoryCount: bigint;
  readonly controlRowCount: bigint;
  readonly controlHash: string;
  readonly releaseMilestoneCount: bigint;
  readonly releaseDocumentCount: bigint;
  readonly releaseSubmissionCount: bigint;
  readonly releaseDocumentSubmissionCount: bigint;
  readonly releaseMarkerCount: bigint;
};

export function inReleaseRemovalFixtureSchema<T>(
  prisma: PrismaService,
  schema: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    return operation(transaction);
  });
}

export async function executeReleaseRemovalMigration(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  for (const statement of migrationStatements(migration)) {
    await transaction.$executeRawUnsafe(statement);
  }
}

export async function resetReleaseRemovalFixture(
  prisma: PrismaService,
  schema: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await inReleaseRemovalFixtureSchema(prisma, schema, async (transaction) => {
    await createFixtureSchema(transaction);
    await insertFixtureRows(transaction);
  });
}

async function createFixtureSchema(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  const statements = [
    `CREATE TYPE "MilestoneSubmissionType" AS ENUM ('FILE', 'TEXT', 'REPOSITORY_RELEASE')`,
    `CREATE TABLE "Program" ("id" TEXT PRIMARY KEY, "payloadHash" TEXT NOT NULL)`,
    `CREATE TABLE "Application" ("id" TEXT PRIMARY KEY, "programId" TEXT NOT NULL REFERENCES "Program"("id"), "payloadHash" TEXT NOT NULL)`,
    `CREATE TABLE "Team" ("id" TEXT PRIMARY KEY, "programId" TEXT NOT NULL REFERENCES "Program"("id"), "payloadHash" TEXT NOT NULL)`,
    `CREATE TABLE "Repository" ("id" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL REFERENCES "Application"("id"), "payloadHash" TEXT NOT NULL)`,
    `CREATE TABLE "Milestone" ("id" TEXT PRIMARY KEY, "programId" TEXT NOT NULL REFERENCES "Program"("id"), "submissionType" "MilestoneSubmissionType" NOT NULL, "payloadHash" TEXT NOT NULL)`,
    `CREATE TABLE "Submission" ("id" TEXT PRIMARY KEY, "milestoneId" TEXT NOT NULL, "applicationId" TEXT NOT NULL REFERENCES "Application"("id"), CONSTRAINT "Submission_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT)`,
    `CREATE TABLE "SubmissionRevision" ("id" TEXT PRIMARY KEY, "submissionId" TEXT NOT NULL, "submissionType" "MilestoneSubmissionType" NOT NULL, "content" JSONB NOT NULL, CONSTRAINT "SubmissionRevision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE)`,
    `CREATE TABLE "Review" ("id" TEXT PRIMARY KEY, "submissionRevisionId" TEXT NOT NULL UNIQUE, CONSTRAINT "Review_submissionRevisionId_fkey" FOREIGN KEY ("submissionRevisionId") REFERENCES "SubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE)`,
    `CREATE TABLE "MilestoneDocument" ("id" TEXT PRIMARY KEY, "milestoneId" TEXT NOT NULL REFERENCES "Milestone"("id"), "submissionType" "MilestoneSubmissionType" NOT NULL, "payloadHash" TEXT NOT NULL)`,
    `CREATE TABLE "MilestoneDocumentTemplateFile" ("id" TEXT PRIMARY KEY, "milestoneDocumentId" TEXT NOT NULL UNIQUE, "payloadHash" TEXT NOT NULL, CONSTRAINT "MilestoneDocumentTemplateFile_milestoneDocumentId_fkey" FOREIGN KEY ("milestoneDocumentId") REFERENCES "MilestoneDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE)`,
    `CREATE TABLE "MilestoneDocumentSubmission" ("id" TEXT PRIMARY KEY, "milestoneDocumentId" TEXT NOT NULL, "applicationId" TEXT NOT NULL REFERENCES "Application"("id"), "content" JSONB, CONSTRAINT "MilestoneDocumentSubmission_milestoneDocumentId_fkey" FOREIGN KEY ("milestoneDocumentId") REFERENCES "MilestoneDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE)`,
    `CREATE TABLE "MilestoneDocumentReviewHistory" ("id" TEXT PRIMARY KEY, "milestoneDocumentSubmissionId" TEXT NOT NULL, CONSTRAINT "MilestoneDocumentReviewHistory_milestoneDocumentSubmission_fkey" FOREIGN KEY ("milestoneDocumentSubmissionId") REFERENCES "MilestoneDocumentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE)`,
    `CREATE TABLE "SubmissionFile" ("id" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL REFERENCES "Application"("id"), "milestoneId" TEXT NOT NULL REFERENCES "Milestone"("id"), "submissionRevisionId" TEXT, "milestoneDocumentSubmissionId" TEXT, "lifecycle" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, CONSTRAINT "SubmissionFile_submissionRevisionId_fkey" FOREIGN KEY ("submissionRevisionId") REFERENCES "SubmissionRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE, CONSTRAINT "SubmissionFile_milestoneDocumentSubmissionId_fkey" FOREIGN KEY ("milestoneDocumentSubmissionId") REFERENCES "MilestoneDocumentSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE, CONSTRAINT "SubmissionFile_attachment_shape_check" CHECK (("lifecycle" = 'ATTACHED' AND num_nonnulls("submissionRevisionId", "milestoneDocumentSubmissionId") = 1) OR "lifecycle" IN ('DELETE_PENDING', 'DELETED')))`,
  ] as const;
  for (const statement of statements) {
    await transaction.$executeRawUnsafe(statement);
  }
}

async function insertFixtureRows(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  const fixtureSql = `
    INSERT INTO "Program" VALUES ('program-control', 'program-hash');
    INSERT INTO "Application" VALUES ('application-control', 'program-control', 'application-hash');
    INSERT INTO "Team" VALUES ('team-control', 'program-control', 'team-hash');
    INSERT INTO "Repository" VALUES ('repository-control', 'application-control', 'repository-hash');
    INSERT INTO "Milestone" VALUES
      ('milestone-file', 'program-control', 'FILE', 'milestone-file-hash'),
      ('milestone-text', 'program-control', 'TEXT', 'milestone-text-hash'),
      ('milestone-release-empty', 'program-control', 'REPOSITORY_RELEASE', 'milestone-release-empty-hash'),
      ('milestone-release-data', 'program-control', 'REPOSITORY_RELEASE', 'milestone-release-data-hash');
    INSERT INTO "Submission" VALUES
      ('submission-file', 'milestone-file', 'application-control'),
      ('submission-text', 'milestone-text', 'application-control'),
      ('submission-release', 'milestone-release-data', 'application-control');
    INSERT INTO "SubmissionRevision" VALUES
      ('revision-file', 'submission-file', 'FILE', '{"type":"FILE","fileId":"file-control"}'),
      ('revision-text', 'submission-text', 'TEXT', '{"type":"TEXT","text":"control text"}'),
      ('revision-release-1', 'submission-release', 'REPOSITORY_RELEASE', '{"type":"REPOSITORY_RELEASE","releaseUrl":"https://example.invalid/release/1"}'),
      ('revision-release-2', 'submission-release', 'REPOSITORY_RELEASE', '{"type":"REPOSITORY_RELEASE","releaseUrl":"https://example.invalid/release/2"}');
    INSERT INTO "Review" VALUES
      ('review-text', 'revision-text'),
      ('review-release-1', 'revision-release-1'),
      ('review-release-2', 'revision-release-2');
    INSERT INTO "MilestoneDocument" VALUES
      ('document-file', 'milestone-file', 'FILE', 'document-file-hash'),
      ('document-text', 'milestone-text', 'TEXT', 'document-text-hash'),
      ('document-release', 'milestone-text', 'REPOSITORY_RELEASE', 'document-release-hash');
    INSERT INTO "MilestoneDocumentTemplateFile" VALUES
      ('template-file', 'document-file', 'template-file-hash'),
      ('template-release', 'document-release', 'template-release-hash');
    INSERT INTO "MilestoneDocumentSubmission" VALUES
      ('document-submission-file', 'document-file', 'application-control', NULL),
      ('document-submission-text', 'document-text', 'application-control', '{"type":"TEXT","text":"document control text"}'),
      ('document-submission-release', 'document-release', 'application-control', '{"type":"REPOSITORY_RELEASE","releaseUrl":"https://example.invalid/document/release"}');
    INSERT INTO "MilestoneDocumentReviewHistory" VALUES
      ('document-review-text', 'document-submission-text'),
      ('document-review-release', 'document-submission-release');
    INSERT INTO "SubmissionFile" VALUES
      ('file-control', 'application-control', 'milestone-file', 'revision-file', NULL, 'ATTACHED', 'file-control-hash'),
      ('file-release-revision', 'application-control', 'milestone-release-data', 'revision-release-1', NULL, 'ATTACHED', 'file-release-revision-hash'),
      ('file-release-document', 'application-control', 'milestone-text', NULL, 'document-submission-release', 'ATTACHED', 'file-release-document-hash');
  `;
  for (const statement of migrationStatements(fixtureSql)) {
    await transaction.$executeRawUnsafe(statement);
  }
}

export function readReleaseRemovalSnapshot(
  transaction: Prisma.TransactionClient,
): Promise<readonly ReleaseRemovalSnapshot[]> {
  return transaction.$queryRaw<ReleaseRemovalSnapshot[]>`
    WITH control_rows AS (
      SELECT 'Program' AS kind, "id", to_jsonb(row) AS payload FROM "Program" AS row
      UNION ALL SELECT 'Application', "id", to_jsonb(row) FROM "Application" AS row
      UNION ALL SELECT 'Team', "id", to_jsonb(row) FROM "Team" AS row
      UNION ALL SELECT 'Repository', "id", to_jsonb(row) FROM "Repository" AS row
      UNION ALL SELECT 'Milestone', "id", to_jsonb(row) FROM "Milestone" AS row WHERE "id" IN ('milestone-file', 'milestone-text')
      UNION ALL SELECT 'Submission', "id", to_jsonb(row) FROM "Submission" AS row WHERE "id" IN ('submission-file', 'submission-text')
      UNION ALL SELECT 'SubmissionRevision', "id", to_jsonb(row) FROM "SubmissionRevision" AS row WHERE "submissionType" IN ('FILE', 'TEXT')
      UNION ALL SELECT 'Review', "id", to_jsonb(row) FROM "Review" AS row WHERE "id" = 'review-text'
      UNION ALL SELECT 'MilestoneDocument', "id", to_jsonb(row) FROM "MilestoneDocument" AS row WHERE "submissionType" IN ('FILE', 'TEXT')
      UNION ALL SELECT 'MilestoneDocumentTemplateFile', "id", to_jsonb(row) FROM "MilestoneDocumentTemplateFile" AS row WHERE "id" = 'template-file'
      UNION ALL SELECT 'MilestoneDocumentSubmission', "id", to_jsonb(row) FROM "MilestoneDocumentSubmission" AS row WHERE "id" IN ('document-submission-file', 'document-submission-text')
      UNION ALL SELECT 'MilestoneDocumentReviewHistory', "id", to_jsonb(row) FROM "MilestoneDocumentReviewHistory" AS row WHERE "id" = 'document-review-text'
      UNION ALL SELECT 'SubmissionFile', "id", to_jsonb(row) FROM "SubmissionFile" AS row WHERE "id" = 'file-control'
    )
    SELECT
      (SELECT COUNT(*) FROM "Program") AS "programCount",
      (SELECT COUNT(*) FROM "Application") AS "applicationCount",
      (SELECT COUNT(*) FROM "Team") AS "teamCount",
      (SELECT COUNT(*) FROM "Repository") AS "repositoryCount",
      (SELECT COUNT(*) FROM control_rows) AS "controlRowCount",
      (SELECT md5(string_agg(kind || ':' || "id" || ':' || payload::text, '|' ORDER BY kind, "id")) FROM control_rows) AS "controlHash",
      (SELECT COUNT(*) FROM "Milestone" WHERE "submissionType"::text = 'REPOSITORY_RELEASE') AS "releaseMilestoneCount",
      (SELECT COUNT(*) FROM "MilestoneDocument" WHERE "submissionType"::text = 'REPOSITORY_RELEASE') AS "releaseDocumentCount",
      (SELECT COUNT(*) FROM "Submission" AS submission JOIN "Milestone" AS milestone ON milestone."id" = submission."milestoneId" WHERE milestone."submissionType"::text = 'REPOSITORY_RELEASE') AS "releaseSubmissionCount",
      (SELECT COUNT(*) FROM "MilestoneDocumentSubmission" AS submission JOIN "MilestoneDocument" AS document ON document."id" = submission."milestoneDocumentId" WHERE document."submissionType"::text = 'REPOSITORY_RELEASE') AS "releaseDocumentSubmissionCount",
      ((SELECT COUNT(*) FROM "SubmissionRevision" WHERE "content"->>'type' = 'REPOSITORY_RELEASE') + (SELECT COUNT(*) FROM "MilestoneDocumentSubmission" WHERE "content"->>'type' = 'REPOSITORY_RELEASE')) AS "releaseMarkerCount"
  `;
}

export function readSubmissionTypeLabels(
  transaction: Prisma.TransactionClient,
): Promise<readonly { readonly label: string }[]> {
  return transaction.$queryRaw`
    SELECT enumlabel AS label
    FROM pg_enum
    WHERE enumtypid = '"MilestoneSubmissionType"'::regtype
    ORDER BY enumsortorder
  `;
}
