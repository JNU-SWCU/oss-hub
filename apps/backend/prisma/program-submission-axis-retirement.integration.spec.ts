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
const schema = 'submission_axis_retirement_fixture';
const inFixture = <T>(
  operation: Parameters<typeof inProgramAuthoringFixtureSchema<T>>[2],
) => inProgramAuthoringFixtureSchema(prisma, schema, operation);
const applySql = (sql: string) =>
  inFixture(async (tx) => {
    for (const statement of migrationStatements(sql))
      await tx.$executeRawUnsafe(statement);
  });
const convertSql = readFileSync(
  resolve(
    __dirname,
    'migrations/20261105040000_convert_submission_axis/migration.sql',
  ),
  'utf8',
);
const reconcileSql = readFileSync(
  resolve(
    __dirname,
    '../../../deploy/jenkins/program-migration/submission-axis/check-retired.sql',
  ),
  'utf8',
);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await applySql(`
      CREATE TYPE "MilestoneSubmissionType" AS ENUM ('FILE', 'TEXT');
      CREATE TYPE "MilestoneDocumentKind" AS ENUM ('DOCUMENT', 'LEGACY_MILESTONE_SUBMISSION');
      CREATE TYPE "MilestoneDocumentSubmissionHistoryEvent" AS ENUM (
        'SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'
      );
      CREATE TABLE "Milestone" (
        "id" text PRIMARY KEY, "name" text NOT NULL,
        "submissionType" "MilestoneSubmissionType",
        "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL
      );
      CREATE TABLE "MilestoneDocument" (
        "id" text PRIMARY KEY, "milestoneId" text NOT NULL REFERENCES "Milestone",
        "name" text NOT NULL, "required" boolean NOT NULL, "sortOrder" integer NOT NULL,
        "kind" "MilestoneDocumentKind" NOT NULL DEFAULT 'DOCUMENT',
        "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL
      );
      CREATE TABLE "MilestoneDocumentSubmission" (
        "id" text PRIMARY KEY, "legacySubmissionId" text UNIQUE,
        "milestoneDocumentId" text NOT NULL REFERENCES "MilestoneDocument",
        "status" text NOT NULL, "revision" integer NOT NULL
      );
      CREATE TABLE "MilestoneDocumentSubmissionHistory" (
        "id" text PRIMARY KEY, "milestoneDocumentSubmissionId" text NOT NULL
          REFERENCES "MilestoneDocumentSubmission" ON UPDATE CASCADE,
        "event" "MilestoneDocumentSubmissionHistoryEvent" NOT NULL,
        "revision" integer, "content" jsonb, "comment" text,
        "actorId" text NOT NULL, "createdAt" timestamp NOT NULL
      );
      CREATE TABLE "MilestoneDocumentReviewHistory" (
        "id" text PRIMARY KEY, "milestoneDocumentSubmissionId" text NOT NULL
          REFERENCES "MilestoneDocumentSubmission" ON UPDATE CASCADE,
        "submissionHistoryId" text REFERENCES "MilestoneDocumentSubmissionHistory" ON UPDATE CASCADE,
        "reviewerId" text NOT NULL, "decision" text NOT NULL, "comment" text,
        "reviewedAt" timestamp NOT NULL, "resubmissionDueAt" timestamp
      );
      CREATE TABLE "SubmissionFile" (
        "id" text PRIMARY KEY, "milestoneId" text REFERENCES "Milestone",
        "milestoneDocumentSubmissionId" text REFERENCES "MilestoneDocumentSubmission" ON UPDATE CASCADE,
        "milestoneDocumentSubmissionHistoryId" text REFERENCES "MilestoneDocumentSubmissionHistory" ON UPDATE CASCADE,
        "lifecycle" text NOT NULL
      );
      INSERT INTO "Milestone" VALUES
        ('legacy', 'Text report', 'TEXT', '2026-01-01', '2026-01-02'),
        ('missing', 'File report', 'FILE', '2026-01-01', '2026-01-02');
      INSERT INTO "MilestoneDocument" VALUES
        ('requirement', 'legacy', 'Text report', true, -1, 'LEGACY_MILESTONE_SUBMISSION', '2026-01-01', '2026-01-02'),
        ('document', 'legacy', 'Attachment', true, 1, 'DOCUMENT', '2026-01-01', '2026-01-02');
      INSERT INTO "MilestoneDocumentSubmission" VALUES
        ('internal-id', 'public-id', 'requirement', 'CHANGES_REQUESTED', 1);
      INSERT INTO "MilestoneDocumentSubmissionHistory" VALUES
        ('revision', 'internal-id', 'SUBMITTED', 1, '{"type":"TEXT","text":"original"}', NULL, 'student', '2026-01-02'),
        ('review-event', 'internal-id', 'CHANGES_REQUESTED', 1, NULL, 'Please revise', 'staff', '2026-01-03');
      INSERT INTO "MilestoneDocumentReviewHistory" VALUES
        ('review', 'internal-id', 'revision', 'staff', 'CHANGES_REQUESTED', 'Please revise', '2026-01-03', '2026-01-10');
      INSERT INTO "SubmissionFile" VALUES
        ('attached', 'legacy', 'internal-id', 'revision', 'ATTACHED'),
        ('pending', 'missing', NULL, NULL, 'PENDING');
    `);
  await applySql(
    readFileSync(
      resolve(
        __dirname,
        'migrations/20261104140000_prepare_submission_axis/migration.sql',
      ),
      'utf8',
    ),
  );
  await applySql(`
 INSERT INTO "MilestoneDocumentSubmission" ("id", "legacySubmissionId", "milestoneDocumentId", "status", "revision")
 SELECT 'public-' || n, 'public-' || n, 'requirement', 'SUBMITTED', 1 FROM generate_series(2,20) n;
 INSERT INTO "Milestone" SELECT 'extra-' || n, 'Extra', 'TEXT', '2026-01-01', '2026-01-02' FROM generate_series(1,6) n;
 INSERT INTO "MilestoneDocument" ("id", "milestoneId", "name", "required", "sortOrder", "kind", "submissionType", "createdAt", "updatedAt")
 SELECT 'extra-req-' || n, 'extra-' || n, 'Extra', true, -1, 'LEGACY_MILESTONE_SUBMISSION', 'TEXT', '2026-01-01', '2026-01-02' FROM generate_series(1,6) n;
 INSERT INTO "MilestoneDocumentSubmission" VALUES ('unknown-revision-submission', NULL, 'document', 'APPROVED', 1);
 INSERT INTO "MilestoneDocumentSubmissionHistory" VALUES
 ('unknown-submitted', 'unknown-revision-submission', 'SUBMITTED', 1, '{"text":"original"}', NULL, 'student', '2026-01-02'),
 ('unknown-review', 'unknown-revision-submission', 'APPROVED', NULL, NULL, 'preserved approval', 'staff', '2026-01-03');
 INSERT INTO "MilestoneDocumentReviewHistory" VALUES ('unknown-review', 'unknown-revision-submission', NULL, 'staff', 'APPROVED', 'preserved approval', '2026-01-03', NULL);
 `);
});
afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

const retireSql = readFileSync(
  resolve(
    __dirname,
    'migrations/20261105050000_retire_submission_axis/migration.sql',
  ),
  'utf8',
);
beforeEach(async () => {
  await applySql(`
    CREATE TABLE "User" ("id" text PRIMARY KEY);
    INSERT INTO "User" VALUES ('staff');
    ALTER TABLE "MilestoneDocumentReviewHistory" ADD CONSTRAINT "retired_review_reviewer_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User";
    UPDATE "MilestoneDocumentReviewHistory" SET "resubmissionDueAt"=NULL;
    INSERT INTO "MilestoneDocumentReviewHistory"
    SELECT 'retired-review-' || n, 'public-id', 'revision', 'staff', 'CHANGES_REQUESTED', 'preserved review ' || n, '2026-01-04'::timestamp, NULL FROM generate_series(1,14) n;
    INSERT INTO "MilestoneDocumentSubmissionHistory"
    SELECT "id", "milestoneDocumentSubmissionId", "decision"::"MilestoneDocumentSubmissionHistoryEvent", 1, NULL, "comment", "reviewerId", "reviewedAt"
    FROM "MilestoneDocumentReviewHistory" WHERE "id" LIKE 'retired-review-%';
  `);
  await applySql(convertSql);
});
it('drops sixteen duplicate reviews and three obsolete columns while preserving canonical facts', async () => {
  const before = await inFixture(
    (tx) =>
      tx.$queryRaw`SELECT to_jsonb(history) AS data FROM "MilestoneDocumentSubmissionHistory" history ORDER BY "id"`,
  );
  await applySql(retireSql);
  expect(
    await inFixture(
      (tx) =>
        tx.$queryRaw`SELECT to_jsonb(history) AS data FROM "MilestoneDocumentSubmissionHistory" history ORDER BY "id"`,
    ),
  ).toEqual(before);
  expect(await inFixture((tx) => tx.$queryRawUnsafe(reconcileSql))).toEqual([
    { '?column?': 0n },
  ]);
  expect(
    await inFixture(
      (tx) =>
        tx.$queryRaw`SELECT "status", "revision" FROM "MilestoneDocumentSubmission" WHERE "id"='unknown-revision-submission'`,
    ),
  ).toEqual([{ status: 'APPROVED', revision: 1 }]);
});
it.each([
  [
    'review count',
    'DELETE FROM "MilestoneDocumentReviewHistory" WHERE "id"=\'retired-review-1\'',
    'exactly 16 retired reviews',
  ],
  [
    'mirror mismatch',
    'UPDATE "MilestoneDocumentSubmissionHistory" SET "comment"=\'changed\' WHERE "id"=\'retired-review-1\'',
    'retired review reconciliation mismatch',
  ],
  [
    'incoming foreign key',
    'CREATE TABLE "UnexpectedReference" ("reviewId" text REFERENCES "MilestoneDocumentReviewHistory")',
    'retired review foreign key count mismatch',
  ],
])(
  'aborts physical retirement for %s without removing the old table',
  async (_name, fault, message) => {
    await applySql(fault);
    await expect(applySql(retireSql)).rejects.toThrow(message);
    expect(
      await inFixture(
        (tx) =>
          tx.$queryRaw`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='MilestoneDocumentReviewHistory'`,
      ),
    ).toEqual([{ n: 1n }]);
  },
);
