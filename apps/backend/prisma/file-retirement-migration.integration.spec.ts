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
const schema = 'file_retirement_fixture';
const inFixture = <T>(
  operation: Parameters<typeof inProgramAuthoringFixtureSchema<T>>[2],
) => inProgramAuthoringFixtureSchema(prisma, schema, operation);
const apply = (sql: string) =>
  inFixture(async (transaction) => {
    for (const statement of migrationStatements(sql)) {
      await transaction.$executeRawUnsafe(statement);
    }
  });
const migration = (name: string) =>
  readFileSync(resolve(__dirname, `migrations/${name}/migration.sql`), 'utf8');
const manifestSql = (name: string) =>
  readFileSync(
    resolve(
      __dirname,
      `../../../deploy/jenkins/program-migration/files/${name}`,
    ),
    'utf8',
  );
const copySql = migration('20261105200000_unify_files');
const retireSql = migration('20261105210000_retire_file_tables');
const singleInteger = async (sql: string) => {
  const rows = await inFixture((transaction) =>
    transaction.$queryRawUnsafe<Record<string, bigint | number>[]>(sql),
  );
  return Number(Object.values(rows[0] ?? {})[0]);
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await apply(FILE_UNIFICATION_SOURCE_FIXTURE_SQL);
  await apply(copySql);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

it('drops the five source tables and keeps the 92 files with timestamps', async () => {
  expect(await singleInteger(manifestSql('check-before-retire.sql'))).toBe(0);
  const fileCount = await singleInteger(manifestSql('count-File.sql'));

  await apply(retireSql);

  expect(await singleInteger(manifestSql('check-retired.sql'))).toBe(0);
  expect(await singleInteger(manifestSql('count-File.sql'))).toBe(fileCount);
  expect(fileCount).toBe(92);
  expect(
    await singleInteger(
      `SELECT count(*) FROM "File" WHERE "createdAt" IS NULL OR "updatedAt" IS NULL`,
    ),
  ).toBe(0);
  expect(
    await singleInteger(
      `SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
       WHERE n.nspname=current_schema() AND t.typname IN (
         'SubmissionFileLifecycle','ProgramAuthoringUploadLifecycle',
         'ProgramPurgeFileTombstoneLifecycle','ProgramCoverSource'
       )`,
    ),
  ).toBe(0);
});

it.each([
  [
    'a template without an attached lifecycle',
    `UPDATE "File" SET lifecycle='PENDING' WHERE kind='TEMPLATE'`,
    'File_kind_lifecycle_check',
  ],
  [
    'an upload with an attached lifecycle',
    `UPDATE "File" SET lifecycle='ATTACHED' WHERE kind='UPLOAD'`,
    'File_kind_lifecycle_check',
  ],
  [
    'a cover file together with an external cover',
    `UPDATE "Program" SET "coverSourceUrl"='https://example.test/source',
       "coverImageUrl"='https://example.test/image' WHERE "coverFileId" IS NOT NULL`,
    'Program_cover_file_or_external_check',
  ],
  [
    'a half external cover',
    `UPDATE "Program" SET "coverFileId"=NULL,
       "coverSourceUrl"='https://example.test/source', "coverImageUrl"=NULL`,
    'Program_cover_file_or_external_check',
  ],
  [
    'a file without a creation time',
    `UPDATE "File" SET "createdAt"=NULL`,
    '23502',
  ],
])('refuses %s after retirement', async (_name, statement, expected) => {
  await apply(retireSql);

  await expect(apply(statement)).rejects.toThrow(expected);
});

it('aborts and keeps the source tables when a source storage key is missing from File', async () => {
  await inFixture((transaction) =>
    transaction.$executeRawUnsafe(
      `DELETE FROM "File" WHERE "storageKey"=(SELECT min("storageKey") FROM "SubmissionFile")`,
    ),
  );
  expect(
    await singleInteger(manifestSql('check-before-retire.sql')),
  ).toBeGreaterThan(0);

  await expect(apply(retireSql)).rejects.toThrow(
    'source storage keys are missing from File',
  );

  expect(await singleInteger(`SELECT count(*) FROM "SubmissionFile"`)).toBe(81);
});

it('aborts and keeps the source tables when a frozen source count changed', async () => {
  await inFixture(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `ALTER TABLE "ProgramPurgeFileTombstone" DISABLE TRIGGER USER`,
    );
    await transaction.$executeRawUnsafe(
      `DELETE FROM "ProgramPurgeFileTombstone" WHERE id=(SELECT min(id) FROM "ProgramPurgeFileTombstone")`,
    );
    await transaction.$executeRawUnsafe(
      `ALTER TABLE "ProgramPurgeFileTombstone" ENABLE TRIGGER USER`,
    );
  });
  expect(
    await singleInteger(manifestSql('check-before-retire.sql')),
  ).toBeGreaterThan(0);

  await expect(apply(retireSql)).rejects.toThrow('source count mismatch');

  expect(await singleInteger(`SELECT count(*) FROM "SubmissionFile"`)).toBe(81);
  expect(
    await singleInteger(`SELECT count(*) FROM "ProgramPurgeFileTombstone"`),
  ).toBe(1);
});

it('reports a legacy attached upload at preflight and refuses to retire it', async () => {
  await inFixture((transaction) =>
    transaction.$executeRawUnsafe(
      `UPDATE "File" SET lifecycle='ATTACHED' WHERE id=(SELECT min(id) FROM "File" WHERE kind='UPLOAD')`,
    ),
  );
  expect(
    await singleInteger(manifestSql('check-before-retire.sql')),
  ).toBeGreaterThan(0);

  await expect(apply(retireSql)).rejects.toThrow('File_kind_lifecycle_check');
});
