import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  inProgramAuthoringFixtureSchema,
  migrationStatements,
} from './program-authoring-migration-test-support';

/**
 * #1133 Issue 수집 마이그레이션이 두 출발점에서 모두 적용되는지 본다.
 *
 * - 새 DB: 격리 러너가 `prisma migrate deploy`로 전체 이력을 적용한 public 스키마.
 * - 직전 마이그레이션까지 적용된 DB: 이 마이그레이션이 건드리는 객체만 직전 모양으로 만든
 *   fixture 스키마에 마이그레이션 문장을 그대로 실행한다(`repository-release-removal` 선례).
 */
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
const GITHUB_REPOSITORY_ID = 9_113_300_000_001n;

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
  await prisma.githubRepository.deleteMany({
    where: { githubRepositoryId: GITHUB_REPOSITORY_ID },
  });
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

it('새 DB에 적용되면 ISSUE stream·issue 이력·issueCount가 스키마 선언대로 생긴다', async () => {
  await expect(streamTypeLabels(prisma)).resolves.toEqual(STREAM_TYPES);

  const repository = await prisma.githubRepository.create({
    data: {
      githubRepositoryId: GITHUB_REPOSITORY_ID,
      nameWithOwner: 'synthetic-1133/issue-migration',
      source: 'ORG_PROVISIONED',
    },
  });
  await prisma.collectionRepositoryStream.create({
    data: { repositoryId: repository.id, streamType: 'ISSUE' },
  });
  const issue = {
    repositoryId: repository.id,
    githubIssueId: 1n,
    state: 'open',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  await prisma.githubIssueHistory.create({ data: issue });
  await expect(
    prisma.githubIssueHistory.create({ data: issue }),
  ).rejects.toMatchObject({ code: 'P2002' });
  const contribution = await prisma.contribution.create({
    data: {
      repositoryId: repository.id,
      githubId: 1n,
      date: new Date('2026-09-01T00:00:00.000Z'),
    },
  });
  expect(contribution.issueCount).toBe(0);

  // 저장소가 지워지면 issue 이력도 다른 fact처럼 따라 지워진다.
  await prisma.githubRepository.delete({ where: { id: repository.id } });
  await expect(
    prisma.githubIssueHistory.count({
      where: { repositoryId: repository.id },
    }),
  ).resolves.toBe(0);
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
      // ADD VALUE가 커밋된 뒤에는 기존 테이블에서 새 값을 바로 쓸 수 있다.
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
  // 기존 집계 행은 그대로이고 새 칸만 0으로 채워진다.
  expect(after.contributions).toEqual([
    { commitCount: 3, pullRequestCount: 2, releaseCount: 1, issueCount: 0 },
  ]);
});
