import { PrismaService } from '../src/prisma/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  columnIsNullable,
  executeSubmissionHistoryMigration,
  inSubmissionHistoryFixtureSchema,
  relationExists,
  resetSubmissionHistoryFixture,
} from './milestone-document-submission-history-migration-test-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SCHEMA = 'milestone_document_history_migration_fixture';
const prisma = new PrismaService();

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

it('현재 제출과 기존 판정을 이력으로 보존하고 단일 첨부를 같은 revision에 연결한다', async () => {
  await resetSubmissionHistoryFixture(prisma, SCHEMA, 1);

  await inSubmissionHistoryFixtureSchema(
    prisma,
    SCHEMA,
    executeSubmissionHistoryMigration,
  );

  await expect(
    inSubmissionHistoryFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$queryRaw`
        SELECT
          history."milestoneDocumentSubmissionId" AS "submissionId",
          history."event"::text AS event,
          history."revision",
          history."content",
          file."id" AS "fileId"
        FROM "MilestoneDocumentSubmissionHistory" AS history
        LEFT JOIN "SubmissionFile" AS file
          ON file."milestoneDocumentSubmissionHistoryId" = history."id"
        ORDER BY history."createdAt"
      `,
    ),
  ).resolves.toEqual([
    {
      submissionId: 'submission-text',
      event: 'SUBMITTED',
      revision: 1,
      content: { type: 'TEXT', text: 'preserved text' },
      fileId: null,
    },
    {
      submissionId: 'submission-file',
      event: 'RESUBMITTED',
      revision: 2,
      content: null,
      fileId: 'file-1',
    },
    {
      submissionId: 'submission-file',
      event: 'CHANGES_REQUESTED',
      revision: null,
      content: null,
      fileId: null,
    },
  ]);
  await expect(
    columnIsNullable(prisma, SCHEMA, 'Milestone', 'submissionType'),
  ).resolves.toBe(true);
  await expect(
    inSubmissionHistoryFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$queryRaw`SELECT "value" FROM "Unrelated" WHERE "id" = 'sentinel'`,
    ),
  ).resolves.toEqual([{ value: 'preserved' }]);
});

it('현재 첨부가 둘이면 어느 revision인지 추측하지 않고 전체를 롤백한다', async () => {
  await resetSubmissionHistoryFixture(prisma, SCHEMA, 2);

  await expect(
    inSubmissionHistoryFixtureSchema(
      prisma,
      SCHEMA,
      executeSubmissionHistoryMigration,
    ),
  ).rejects.toMatchObject({
    code: 'P2010',
    meta: {
      code: '23514',
    },
  });

  await expect(
    relationExists(prisma, SCHEMA, 'MilestoneDocumentSubmissionHistory'),
  ).resolves.toBe(false);
  await expect(
    columnIsNullable(prisma, SCHEMA, 'Milestone', 'submissionType'),
  ).resolves.toBe(false);
  await expect(
    inSubmissionHistoryFixtureSchema(
      prisma,
      SCHEMA,
      (transaction) =>
        transaction.$queryRaw`SELECT "value" FROM "Unrelated" WHERE "id" = 'sentinel'`,
    ),
  ).resolves.toEqual([{ value: 'preserved' }]);
});
