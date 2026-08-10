import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  executeReleaseRemovalMigration,
  inReleaseRemovalFixtureSchema,
  readReleaseRemovalSnapshot,
  readSubmissionTypeLabels,
  REPOSITORY_RELEASE_REMOVAL_MIGRATION_NAME,
  resetReleaseRemovalFixture,
} from './repository-release-removal-migration-test-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SCHEMA = 'repository_release_removal_fixture';
const prisma = new PrismaService();
const executeFile = promisify(execFile);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

it('upgrades P2 release variants while preserving FILE/TEXT and unrelated hashes', async () => {
  await resetReleaseRemovalFixture(prisma, SCHEMA);
  const before = await inReleaseRemovalFixtureSchema(
    prisma,
    SCHEMA,
    readReleaseRemovalSnapshot,
  );

  await inReleaseRemovalFixtureSchema(
    prisma,
    SCHEMA,
    executeReleaseRemovalMigration,
  );

  const after = await inReleaseRemovalFixtureSchema(
    prisma,
    SCHEMA,
    readReleaseRemovalSnapshot,
  );
  expect(after[0]).toMatchObject({
    programCount: before[0]?.programCount,
    applicationCount: before[0]?.applicationCount,
    teamCount: before[0]?.teamCount,
    repositoryCount: before[0]?.repositoryCount,
    controlRowCount: before[0]?.controlRowCount,
    controlHash: before[0]?.controlHash,
    releaseMilestoneCount: 0n,
    releaseDocumentCount: 0n,
    releaseSubmissionCount: 0n,
    releaseDocumentSubmissionCount: 0n,
    releaseMarkerCount: 0n,
  });
  await expect(
    inReleaseRemovalFixtureSchema(prisma, SCHEMA, readSubmissionTypeLabels),
  ).resolves.toEqual([{ label: 'FILE' }, { label: 'TEXT' }]);
  await expect(
    inReleaseRemovalFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$queryRaw`
          SELECT "id", "submissionType"::text AS "submissionType"
          FROM "Milestone"
          WHERE "id" LIKE 'milestone-release-%'
          ORDER BY "id"
        `,
    ),
  ).resolves.toEqual([
    { id: 'milestone-release-data', submissionType: 'TEXT' },
    { id: 'milestone-release-empty', submissionType: 'TEXT' },
  ]);
});

it('aborts an unexpected release marker before destructive mutation', async () => {
  await resetReleaseRemovalFixture(prisma, SCHEMA);
  await inReleaseRemovalFixtureSchema(
    prisma,
    SCHEMA,
    (transaction) =>
      transaction.$executeRaw`
      UPDATE "SubmissionRevision"
      SET "content" = '{"type":"REPOSITORY_RELEASE","releaseUrl":"https://example.invalid/unexpected"}'::jsonb
      WHERE "id" = 'revision-text'
    `,
  );
  const before = await inReleaseRemovalFixtureSchema(
    prisma,
    SCHEMA,
    readReleaseRemovalSnapshot,
  );

  await expect(
    inReleaseRemovalFixtureSchema(
      prisma,
      SCHEMA,
      executeReleaseRemovalMigration,
    ),
  ).rejects.toThrow(/unexpected release marker/);

  await expect(
    inReleaseRemovalFixtureSchema(prisma, SCHEMA, readReleaseRemovalSnapshot),
  ).resolves.toEqual(before);
  await expect(
    inReleaseRemovalFixtureSchema(prisma, SCHEMA, readSubmissionTypeLabels),
  ).resolves.toEqual([
    { label: 'FILE' },
    { label: 'TEXT' },
    { label: 'REPOSITORY_RELEASE' },
  ]);
});

it('aborts an unexpected foreign key before destructive mutation', async () => {
  await resetReleaseRemovalFixture(prisma, SCHEMA);
  await inReleaseRemovalFixtureSchema(prisma, SCHEMA, async (transaction) => {
    await transaction.$executeRawUnsafe(`
      CREATE TABLE "UnexpectedReleaseReference" (
        "id" TEXT PRIMARY KEY,
        "submissionRevisionId" TEXT NOT NULL REFERENCES "SubmissionRevision"("id")
      )
    `);
    await transaction.$executeRaw`
      INSERT INTO "UnexpectedReleaseReference" VALUES ('unexpected-reference', 'revision-release-1')
    `;
  });
  const before = await inReleaseRemovalFixtureSchema(
    prisma,
    SCHEMA,
    readReleaseRemovalSnapshot,
  );

  await expect(
    inReleaseRemovalFixtureSchema(
      prisma,
      SCHEMA,
      executeReleaseRemovalMigration,
    ),
  ).rejects.toThrow(/unexpected foreign key/);

  await expect(
    inReleaseRemovalFixtureSchema(prisma, SCHEMA, readReleaseRemovalSnapshot),
  ).resolves.toEqual(before);
});

it.each(['DELETE_PENDING', 'DELETED'] as const)(
  'aborts a dual-linked %s release file before mutation',
  async (lifecycle) => {
    await resetReleaseRemovalFixture(prisma, SCHEMA);
    await inReleaseRemovalFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$executeRaw`
          INSERT INTO "SubmissionFile" (
            "id", "applicationId", "milestoneId", "submissionRevisionId",
            "milestoneDocumentSubmissionId", "lifecycle", "payloadHash"
          ) VALUES (
            'file-release-dual-link', 'application-control', 'milestone-release-data',
            'revision-release-1', 'document-submission-text', ${lifecycle},
            'file-release-dual-link-hash'
          )
        `,
    );
    const before = await inReleaseRemovalFixtureSchema(
      prisma,
      SCHEMA,
      readReleaseRemovalSnapshot,
    );

    await expect(
      inReleaseRemovalFixtureSchema(
        prisma,
        SCHEMA,
        executeReleaseRemovalMigration,
      ),
    ).rejects.toThrow(/dual-linked release file/);

    await expect(
      inReleaseRemovalFixtureSchema(prisma, SCHEMA, readReleaseRemovalSnapshot),
    ).resolves.toEqual(before);
  },
);

it.each([
  [
    'missing',
    ['ALTER TABLE "Review" DROP CONSTRAINT "Review_submissionRevisionId_fkey"'],
  ],
  [
    'unvalidated',
    [
      'ALTER TABLE "Review" DROP CONSTRAINT "Review_submissionRevisionId_fkey"',
      'ALTER TABLE "Review" ADD CONSTRAINT "Review_submissionRevisionId_fkey" FOREIGN KEY ("submissionRevisionId") REFERENCES "SubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID',
    ],
  ],
  [
    'malformed action',
    [
      'ALTER TABLE "SubmissionFile" DROP CONSTRAINT "SubmissionFile_milestoneDocumentSubmissionId_fkey"',
      'ALTER TABLE "SubmissionFile" ADD CONSTRAINT "SubmissionFile_milestoneDocumentSubmissionId_fkey" FOREIGN KEY ("milestoneDocumentSubmissionId") REFERENCES "MilestoneDocumentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
    ],
  ],
  [
    'malformed source column',
    [
      'ALTER TABLE "Review" DROP CONSTRAINT "Review_submissionRevisionId_fkey"',
      'UPDATE "Review" SET "id" = "submissionRevisionId"',
      'ALTER TABLE "Review" ADD CONSTRAINT "Review_submissionRevisionId_fkey" FOREIGN KEY ("id") REFERENCES "SubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
    ],
  ],
  [
    'malformed target column',
    [
      'ALTER TABLE "SubmissionRevision" ADD COLUMN "legacyId" TEXT UNIQUE',
      'UPDATE "SubmissionRevision" SET "legacyId" = "id"',
      'ALTER TABLE "Review" DROP CONSTRAINT "Review_submissionRevisionId_fkey"',
      'ALTER TABLE "Review" ADD CONSTRAINT "Review_submissionRevisionId_fkey" FOREIGN KEY ("submissionRevisionId") REFERENCES "SubmissionRevision"("legacyId") ON DELETE RESTRICT ON UPDATE CASCADE',
    ],
  ],
  [
    'renamed',
    [
      'ALTER TABLE "Review" RENAME CONSTRAINT "Review_submissionRevisionId_fkey" TO "Review_submissionRevisionId_renamed_fkey"',
    ],
  ],
] as const)(
  'aborts a %s expected foreign key before mutation',
  async (_case, statements) => {
    await resetReleaseRemovalFixture(prisma, SCHEMA);
    await inReleaseRemovalFixtureSchema(prisma, SCHEMA, async (transaction) => {
      for (const statement of statements) {
        await transaction.$executeRawUnsafe(statement);
      }
    });
    const before = await inReleaseRemovalFixtureSchema(
      prisma,
      SCHEMA,
      readReleaseRemovalSnapshot,
    );

    await expect(
      inReleaseRemovalFixtureSchema(
        prisma,
        SCHEMA,
        executeReleaseRemovalMigration,
      ),
    ).rejects.toThrow(/foreign key contract/);

    await expect(
      inReleaseRemovalFixtureSchema(prisma, SCHEMA, readReleaseRemovalSnapshot),
    ).resolves.toEqual(before);
  },
);

it('fresh deploy has the final enum and rerun records no additional migration', async () => {
  await expect(
    prisma.$queryRaw`
      SELECT enumlabel AS label
      FROM pg_enum
      WHERE enumtypid = '"MilestoneSubmissionType"'::regtype
      ORDER BY enumsortorder
    `,
  ).resolves.toEqual([{ label: 'FILE' }, { label: 'TEXT' }]);
  const before = await prisma.$queryRaw<
    readonly { readonly appliedStepsCount: number }[]
  >`
    SELECT applied_steps_count AS "appliedStepsCount"
    FROM _prisma_migrations
    WHERE migration_name = ${REPOSITORY_RELEASE_REMOVAL_MIGRATION_NAME}
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  `;
  expect(before).toEqual([{ appliedStepsCount: 1 }]);

  await executeFile('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: process.env,
  });
  await executeFile('pnpm', ['exec', 'prisma', 'migrate', 'status'], {
    cwd: process.cwd(),
    env: process.env,
  });

  await expect(
    prisma.$queryRaw`
      SELECT applied_steps_count AS "appliedStepsCount"
      FROM _prisma_migrations
      WHERE migration_name = ${REPOSITORY_RELEASE_REMOVAL_MIGRATION_NAME}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `,
  ).resolves.toEqual(before);
});
