import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
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

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    'migrations/20260924090000_add_github_issue_history/migration.sql',
  ),
  'utf8',
);
const SCHEMA = 'github_issue_history_fixture';
const STREAM_TYPES = ['COMMIT', 'PULL_REQUEST', 'RELEASE', 'ISSUE'];

const prisma = new PrismaService();

const streamTypeLabels = async (
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<string[]> =>
  (
    await client.$queryRaw<Array<{ label: string }>>`
      SELECT enumlabel AS label FROM pg_enum
      WHERE enumtypid = '"CollectionStreamType"'::regtype
      ORDER BY enumsortorder
    `
  ).map((row) => row.label);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

it('직전 마이그레이션까지 적용된 DB에 적용해도 기존 행을 보존하고 새 stream 값을 바로 쓴다', async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
  await inProgramAuthoringFixtureSchema(prisma, SCHEMA, async (transaction) => {
    for (const statement of [
      `CREATE TYPE "CollectionStreamType" AS ENUM ('COMMIT', 'PULL_REQUEST', 'RELEASE')`,
      `CREATE TABLE "GithubRepository" ("id" TEXT PRIMARY KEY)`,
      `CREATE TABLE "CollectionRepositoryStream" ("id" TEXT PRIMARY KEY, "repositoryId" TEXT NOT NULL REFERENCES "GithubRepository"("id") ON DELETE CASCADE, "streamType" "CollectionStreamType" NOT NULL)`,
      `CREATE TABLE "Contribution" ("repositoryId" TEXT NOT NULL REFERENCES "GithubRepository"("id") ON DELETE CASCADE, "githubId" BIGINT NOT NULL, "date" DATE NOT NULL, "commitCount" INTEGER NOT NULL DEFAULT 0, "pullRequestCount" INTEGER NOT NULL DEFAULT 0, "releaseCount" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL, PRIMARY KEY ("repositoryId", "githubId", "date"))`,
      `INSERT INTO "GithubRepository" VALUES ('repository-before')`,
      `INSERT INTO "CollectionRepositoryStream" VALUES ('stream-before', 'repository-before', 'PULL_REQUEST')`,
      `INSERT INTO "Contribution" VALUES ('repository-before', 1, '2026-09-01', 3, 2, 1, CURRENT_TIMESTAMP)`,
    ]) {
      await transaction.$executeRawUnsafe(statement);
    }
  });

  await inProgramAuthoringFixtureSchema(prisma, SCHEMA, async (transaction) => {
    for (const statement of migrationStatements(MIGRATION)) {
      await transaction.$executeRawUnsafe(statement);
    }
  });

  const after = await inProgramAuthoringFixtureSchema(
    prisma,
    SCHEMA,
    async (transaction) => {
      await transaction.$executeRawUnsafe(
        `INSERT INTO "CollectionRepositoryStream" VALUES ('stream-issue', 'repository-before', 'ISSUE')`,
      );
      await transaction.$executeRawUnsafe(
        `INSERT INTO "GithubIssueHistory" ("id", "repositoryId", "githubIssueId", "state", "createdAt") VALUES ('issue-1', 'repository-before', 1, 'open', CURRENT_TIMESTAMP)`,
      );
      return {
        labels: await streamTypeLabels(transaction),
        contributions: await transaction.$queryRaw`
          SELECT "commitCount", "pullRequestCount", "releaseCount", "issueCount"
          FROM "Contribution"
        `,
      };
    },
  );

  expect(after.labels).toEqual(STREAM_TYPES);

  expect(after.contributions).toEqual([
    { commitCount: 3, pullRequestCount: 2, releaseCount: 1, issueCount: 0 },
  ]);
});
