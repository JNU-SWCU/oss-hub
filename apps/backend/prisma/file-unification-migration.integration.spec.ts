import { FILE_UNIFICATION_SOURCE_FIXTURE_SQL } from './file-unification-migration.fixture';
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
const schema = 'file_unification_fixture';
const inFixture = <T>(
  operation: Parameters<typeof inProgramAuthoringFixtureSchema<T>>[2],
) => inProgramAuthoringFixtureSchema(prisma, schema, operation);
const apply = (sql: string) =>
  inFixture(async (transaction) => {
    for (const statement of migrationStatements(sql)) {
      await transaction.$executeRawUnsafe(statement);
    }
  });
const copySql = readFileSync(
  resolve(__dirname, 'migrations/20261105200000_unify_files/migration.sql'),
  'utf8',
);
const reconcileSql = readFileSync(
  resolve(
    __dirname,
    '../../../deploy/jenkins/program-migration/files/check-copy.sql',
  ),
  'utf8',
);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await apply(FILE_UNIFICATION_SOURCE_FIXTURE_SQL);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

it('copies 94 source rows into 92 unique files without losing shared upload metadata', async () => {
  await apply(copySql);

  expect(
    await inFixture((transaction) => transaction.$queryRawUnsafe(reconcileSql)),
  ).toEqual([{ '?column?': 0n }]);
  expect(
    await inFixture(
      (transaction) => transaction.$queryRaw`
    SELECT id, sha256, "requirementId" FROM "File" WHERE "storageKey"='program-authoring/template-1'
  `,
    ),
  ).toEqual([
    {
      id: 'template-1',
      sha256: 'a'.repeat(64),
      requirementId: 'requirement-1',
    },
  ]);
});

it.each([
  [
    'count mismatch',
    `DELETE FROM "SubmissionFile" WHERE id='submission-file-1'`,
    'file source count mismatch',
  ],
  [
    'metadata mismatch',
    `UPDATE "ProgramAuthoringUpload" SET "mimeType"='text/plain' WHERE id='upload-1'`,
    'file upload/template metadata mismatch',
  ],
  [
    'identity collision',
    `UPDATE "ProgramCover" SET id='submission-file-1' WHERE id='cover-1'`,
    'canonical file identity collision',
  ],
  [
    'owner mismatch',
    `UPDATE "SubmissionFile" SET "milestoneDocumentId"='requirement-2' WHERE id='submission-file-1'`,
    'file submission owner mismatch',
  ],
])(
  'aborts %s before committing any new structure',
  async (_name, fault, message) => {
    await apply(fault);

    await expect(apply(copySql)).rejects.toThrow(message);

    expect(
      await inFixture(
        (transaction) => transaction.$queryRaw`
    SELECT count(*) AS n FROM information_schema.tables
    WHERE table_schema=current_schema() AND table_name='File'
  `,
      ),
    ).toEqual([{ n: 0n }]);
  },
);

it('copies the Todo 9 shape that still carries the retiring applicationId foreign key', async () => {
  await apply(`
    ALTER TABLE "SubmissionFile" ADD COLUMN "applicationId" text REFERENCES "User"(id);
  `);

  await apply(copySql);

  expect(
    await inFixture((transaction) => transaction.$queryRawUnsafe(reconcileSql)),
  ).toEqual([{ '?column?': 0n }]);
});

it('aborts when an unknown foreign key still references the old structure', async () => {
  await apply(
    `ALTER TABLE "ProgramCover" ADD FOREIGN KEY ("programId") REFERENCES "Program"`,
  );

  await expect(apply(copySql)).rejects.toThrow(
    'retired file outgoing foreign key count mismatch',
  );
});

it.each([
  [
    'pending submission without a team',
    `INSERT INTO "File" (id,kind,lifecycle,"storageKey","requirementId","pendingExpiresAt","expiresAt")
     VALUES ('bad','SUBMISSION','PENDING','submission-files/bad','requirement-1','2027-01-01','2027-01-01')`,
    'File_kind_owner_check',
  ],
  [
    'pending submission without a requirement',
    `INSERT INTO "File" (id,kind,lifecycle,"storageKey","teamId","pendingExpiresAt","expiresAt")
     VALUES ('bad','SUBMISSION','PENDING','submission-files/bad','team','2027-01-01','2027-01-01')`,
    'File_kind_owner_check',
  ],
  [
    'attached submission without a history',
    `INSERT INTO "File" (id,kind,lifecycle,"storageKey","teamId","submissionId")
     VALUES ('bad','SUBMISSION','ATTACHED','submission-files/bad','team','submission')`,
    'File_kind_owner_check',
  ],
  [
    'template owned by a team',
    `INSERT INTO "File" (id,kind,lifecycle,"storageKey","requirementId","teamId")
     VALUES ('bad','TEMPLATE','ATTACHED','program-authoring/bad','requirement-1','team')`,
    'File_kind_owner_check',
  ],
  [
    'cover outside the cover prefix',
    `INSERT INTO "File" (id,kind,lifecycle,"storageKey","programId","mimeType","sizeBytes")
     VALUES ('bad','COVER','DELETE_PENDING','submission-files/bad','program-1','image/png',1)`,
    'File_cover_metadata_check',
  ],
])('refuses a kind-violating INSERT: %s', async (_name, insert, constraint) => {
  await apply(copySql);

  await expect(apply(insert)).rejects.toThrow(constraint);
});

it('rejects stale writers after copy and allows the new owner to delete an unsubmitted requirement', async () => {
  await apply(copySql);
  await expect(
    apply(
      `UPDATE "SubmissionFile" SET "sizeBytes"=2 WHERE id='submission-file-1'`,
    ),
  ).rejects.toThrow('retired file storage is read only after File cutover');

  await apply(`
    UPDATE "File" SET lifecycle='DELETE_PENDING', "requirementId"=NULL, "nextDeleteAttemptAt"=CURRENT_TIMESTAMP
    WHERE "requirementId"='requirement-5';
    DELETE FROM "MilestoneDocument" WHERE id='requirement-5';
  `);

  expect(
    await inFixture(
      (transaction) => transaction.$queryRaw`
    SELECT count(*) AS n FROM "MilestoneDocumentTemplateFile" WHERE id='template-5'
  `,
    ),
  ).toEqual([{ n: 1n }]);
});
