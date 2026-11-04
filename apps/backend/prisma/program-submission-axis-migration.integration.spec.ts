import { readdirSync, readFileSync } from 'node:fs';
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
const schema = 'submission_axis_migration_fixture';
const inFixture = <T>(
  operation: Parameters<typeof inProgramAuthoringFixtureSchema<T>>[2],
) => inProgramAuthoringFixtureSchema(prisma, schema, operation);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await inFixture(async (tx) => {
    for (const sql of migrationStatements(`
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
    `)) {
      await tx.$executeRawUnsafe(sql);
    }
  });
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

async function migrate(): Promise<void> {
  const migrations = resolve(__dirname, 'migrations');
  await inFixture(async (tx) => {
    for (const name of readdirSync(migrations)
      .filter((entry) => entry.endsWith('_prepare_submission_axis'))
      .sort()) {
      for (const sql of migrationStatements(
        readFileSync(resolve(migrations, name, 'migration.sql'), 'utf8'),
      )) {
        await tx.$executeRawUnsafe(sql);
      }
    }
  });
}

it('preserves the public submission identity and every incoming history and file link', async () => {
  await migrate();

  await expect(
    inFixture(
      (tx) => tx.$queryRaw`
      SELECT submission."id", submission."revision", submission."status",
        file."milestoneDocumentSubmissionId" AS "fileSubmissionId",
        history."milestoneDocumentSubmissionId" AS "historySubmissionId"
      FROM "MilestoneDocumentSubmission" submission
      JOIN "SubmissionFile" file ON file."milestoneDocumentSubmissionId" = submission."id"
      JOIN "MilestoneDocumentSubmissionHistory" history ON history."id" = 'revision'
    `,
    ),
  ).resolves.toEqual([
    {
      id: 'public-id',
      revision: 1,
      status: 'CHANGES_REQUESTED',
      fileSubmissionId: 'public-id',
      historySubmissionId: 'public-id',
    },
  ]);
});

it('rejects a public ID collision atomically before changing any submission or history', async () => {
  await inFixture(
    (tx) => tx.$executeRaw`
    INSERT INTO "MilestoneDocumentSubmission" VALUES ('public-id', NULL, 'document', 'SUBMITTED', 1)
  `,
  );

  await expect(migrate()).rejects.toThrow('submission public ID collision');

  await expect(
    inFixture(
      (tx) => tx.$queryRaw`
      SELECT "id" FROM "MilestoneDocumentSubmission" ORDER BY "id"
    `,
    ),
  ).resolves.toEqual([{ id: 'internal-id' }, { id: 'public-id' }]);
  await expect(
    inFixture(
      (tx) => tx.$queryRaw`
      SELECT "milestoneDocumentSubmissionId" FROM "MilestoneDocumentSubmissionHistory" WHERE "id" = 'review-event'
    `,
    ),
  ).resolves.toEqual([{ milestoneDocumentSubmissionId: 'internal-id' }]);
});

it('rejects a pending file whose requirement cannot be determined from the old schema', async () => {
  await inFixture(
    (tx) => tx.$executeRaw`
    UPDATE "SubmissionFile" SET "milestoneId" = 'legacy' WHERE "id" = 'pending'
  `,
  );

  await expect(migrate()).rejects.toThrow(
    'pending submission file ownership is ambiguous',
  );

  await expect(
    inFixture(
      (tx) => tx.$queryRaw`SELECT "id" FROM "MilestoneDocumentSubmission"`,
    ),
  ).resolves.toEqual([{ id: 'internal-id' }]);
});

it('rejects a review public ID collision before rewriting either identity', async () => {
  await inFixture(
    (tx) => tx.$executeRaw`
    INSERT INTO "MilestoneDocumentSubmissionHistory"
    VALUES ('review', 'internal-id', 'SUBMITTED', 1, NULL, NULL, 'student', '2026-01-02')
  `,
  );

  await expect(migrate()).rejects.toThrow(
    'submission review public ID collision',
  );

  await expect(
    inFixture(
      (tx) => tx.$queryRaw`SELECT "id" FROM "MilestoneDocumentSubmission"`,
    ),
  ).resolves.toEqual([{ id: 'internal-id' }]);
});

it('preserves review identity and comment in the existing event without adding a second event', async () => {
  await migrate();

  await expect(
    inFixture(
      (tx) => tx.$queryRaw`
      SELECT "id", "event"::text, "revision", "comment", "actorId", "createdAt"
      FROM "MilestoneDocumentSubmissionHistory" WHERE "event" = 'CHANGES_REQUESTED'
    `,
    ),
  ).resolves.toEqual([
    {
      id: 'review',
      event: 'CHANGES_REQUESTED',
      revision: 1,
      comment: 'Please revise',
      actorId: 'staff',
      createdAt: new Date('2026-01-03'),
    },
  ]);
});

it('retains requirement types and creates the missing required item with source timestamps', async () => {
  await migrate();

  await expect(
    inFixture(
      (tx) => tx.$queryRaw`
      SELECT "milestoneId", "name", "required", "submissionType"::text, "createdAt", "updatedAt"
      FROM "MilestoneDocument" ORDER BY "milestoneId", "name"
    `,
    ),
  ).resolves.toEqual([
    {
      milestoneId: 'legacy',
      name: 'Attachment',
      required: true,
      submissionType: 'FILE_OR_TEXT',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    },
    {
      milestoneId: 'legacy',
      name: 'Text report',
      required: true,
      submissionType: 'TEXT',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    },
    {
      milestoneId: 'missing',
      name: 'File report',
      required: true,
      submissionType: 'FILE',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    },
  ]);
});

it.each(['review-first', 'event-first'])(
  'preserves the previous backend review ID and comment with %s writes',
  async (order) => {
    await migrate();
    const review = `
      INSERT INTO "MilestoneDocumentReviewHistory"
      VALUES ('rolling-review', 'public-id', 'revision', 'staff', 'CHANGES_REQUESTED',
        'rolling deployment', '2026-01-04', '2026-01-20')
    `;
    const event = `
      INSERT INTO "MilestoneDocumentSubmissionHistory" (
        "id", "milestoneDocumentSubmissionId", "event", "revision",
        "comment", "actorId", "createdAt"
      ) VALUES ('rolling-event', 'public-id', 'CHANGES_REQUESTED', 1,
        'rolling deployment', 'staff', '2026-01-04')
    `;

    await inFixture(async (tx) => {
      for (const sql of order === 'review-first'
        ? [review, event]
        : [event, review]) {
        await tx.$executeRawUnsafe(sql);
      }
    });

    await expect(
      inFixture(
        (tx) => tx.$queryRaw`
        SELECT "id", "comment" FROM "MilestoneDocumentSubmissionHistory"
        WHERE "comment" = 'rolling deployment'
      `,
      ),
    ).resolves.toEqual([
      {
        id: 'rolling-review',
        comment: 'rolling deployment',
      },
    ]);
  },
);

it('stores a new-backend review comment without requiring a legacy review row', async () => {
  await migrate();

  await inFixture(
    (tx) => tx.$executeRaw`
    INSERT INTO "MilestoneDocumentSubmissionHistory" (
      "id", "milestoneDocumentSubmissionId", "event", "revision",
      "comment", "actorId", "createdAt"
    ) VALUES ('new-review', 'public-id', 'CHANGES_REQUESTED', 1,
      'new backend', 'staff', '2026-01-05')
  `,
  );

  await expect(
    inFixture(
      (tx) => tx.$queryRaw`
      SELECT "comment" FROM "MilestoneDocumentSubmissionHistory"
      WHERE "id" = 'new-review'
    `,
    ),
  ).resolves.toEqual([{ comment: 'new backend' }]);
});
