import { randomUUID } from 'node:crypto';
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

const sql = readFileSync(
  resolve(
    __dirname,
    'migrations/20261104130000_retire_teamless_github_repositories/migration.sql',
  ),
  'utf8',
);
const schema = `github_scope_${randomUUID().replaceAll('-', '')}`;
const prisma = new PrismaService();
const approved = [
  ['CollectionCommitFact', 167],
  ['Contribution', 25],
  ['CollectionRepositoryStream', 40],
  ['CollectionPullRequestFact', 15],
  ['CollectionReleaseFact', 9],
  ['GithubRepositoryOutsiderContribution', 1],
  ['RepositoryInvitation', 9],
  ['CollectionRepositoryYearAggregate', 1],
  ['CollectionContributorYearAggregate', 2],
  ['GithubIssueHistory', 0],
  ['RepositoryProvisionJob', 0],
  ['RepositoryIssuanceHistory', 0],
] as const;

const inSchema = <T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) => inProgramAuthoringFixtureSchema(prisma, schema, operation);

async function apply(): Promise<void> {
  await inSchema(async (transaction) => {
    for (const statement of migrationStatements(sql)) {
      await transaction.$executeRawUnsafe(statement);
    }
  });
}

async function seedApprovedScope(): Promise<void> {
  await inSchema(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "Application" VALUES ('keep-application', 'keep-team')`,
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "GithubRepository" VALUES ('keep', 'keep-application', NULL)`,
    );
    await transaction.$executeRawUnsafe(`
      INSERT INTO "GithubRepository"
      SELECT 'retire-' || n, NULL, NULL FROM generate_series(1, 12) n
    `);
    for (const [table, count] of approved) {
      await transaction.$executeRawUnsafe(`
        INSERT INTO "${table}" SELECT 'retire-' || n, 'retire-1'
        FROM generate_series(1, ${count}) n
      `);
      await transaction.$executeRawUnsafe(
        `INSERT INTO "${table}" VALUES ('keep', 'keep')`,
      );
    }
    await transaction.$executeRawUnsafe(
      `INSERT INTO "AuditLog" VALUES ('audit', 'retire-1')`,
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "GithubUserActivityHistory" VALUES ('ranking', 17)`,
    );
  });
}

beforeAll(() => prisma.$connect());
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await inSchema(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `CREATE TABLE "User" (id text PRIMARY KEY)`,
    );
    await transaction.$executeRawUnsafe(
      `CREATE TABLE "Program" (id text PRIMARY KEY)`,
    );
    await transaction.$executeRawUnsafe(
      `CREATE TABLE "Application" (id text PRIMARY KEY, "teamId" text NOT NULL)`,
    );
    await transaction.$executeRawUnsafe(`CREATE TABLE "GithubRepository" (
      id text PRIMARY KEY, "applicationId" text REFERENCES "Application"(id), "teamId" text
    )`);
    for (const [table] of approved) {
      const deletion =
        table === 'RepositoryInvitation' ? 'RESTRICT' : 'CASCADE';
      await transaction.$executeRawUnsafe(`CREATE TABLE "${table}" (
        id text PRIMARY KEY,
        "repositoryId" text REFERENCES "GithubRepository"(id) ON DELETE ${deletion}
      )`);
    }
    await transaction.$executeRawUnsafe(
      `CREATE TABLE "AuditLog" (id text PRIMARY KEY, "targetId" text)`,
    );
    await transaction.$executeRawUnsafe(
      `CREATE TABLE "GithubUserActivityHistory" (id text PRIMARY KEY, "commitCount" integer)`,
    );
  });
});
afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
});

it('승인 범위만 삭제하고 연결 팀·랭킹·감사·무관한 레거시 집계를 보존한다', async () => {
  await seedApprovedScope();
  await apply();
  await inSchema(async (transaction) => {
    expect(
      await transaction.$queryRaw`SELECT * FROM "GithubRepository"`,
    ).toEqual([
      { id: 'keep', applicationId: 'keep-application', teamId: 'keep-team' },
    ]);
    for (const [table] of approved) {
      expect(
        await transaction.$queryRawUnsafe(`SELECT * FROM "${table}"`),
      ).toEqual([{ id: 'keep', repositoryId: 'keep' }]);
    }
    expect(await transaction.$queryRaw`SELECT * FROM "AuditLog"`).toEqual([
      { id: 'audit', targetId: 'retire-1' },
    ]);
    expect(
      await transaction.$queryRaw`SELECT * FROM "GithubUserActivityHistory"`,
    ).toEqual([{ id: 'ranking', commitCount: 17 }]);
  });
});

it.each([
  ['GithubRepository', 'id'],
  ...approved.filter(([, count]) => count > 0).map(([table]) => [table, 'id']),
])('%s 건수가 다르면 어느 데이터도 삭제하지 않는다', async (table) => {
  await seedApprovedScope();
  await inSchema(async (transaction) => {
    if (table === 'GithubRepository') {
      await transaction.$executeRawUnsafe(
        `INSERT INTO "GithubRepository" VALUES ('unexpected', NULL, NULL)`,
      );
    } else {
      await transaction.$executeRawUnsafe(
        `INSERT INTO "${table}" VALUES ('unexpected', 'retire-1')`,
      );
    }
  });
  await expect(apply()).rejects.toThrow('github scope retirement:');
  await expect(
    inSchema(
      (transaction) => transaction.$queryRaw`
    SELECT count(*)::integer AS count FROM "GithubRepository" WHERE id LIKE 'retire-%'
  `,
    ),
  ).resolves.toEqual([{ count: 12 }]);
  await expect(
    inSchema(
      (transaction) => transaction.$queryRaw`
    SELECT "teamId" FROM "GithubRepository" WHERE id = 'keep'
  `,
    ),
  ).resolves.toEqual([{ teamId: null }]);
});

it('빈 DB는 삭제 없이 마이그레이션하고 팀당 레포 하나를 강제한다', async () => {
  await apply();
  await inSchema(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "GithubRepository" VALUES ('first', NULL, 'team')`,
    );
  });
  await expect(
    inSchema((transaction) =>
      transaction.$executeRawUnsafe(
        `INSERT INTO "GithubRepository" VALUES ('second', NULL, 'team')`,
      ),
    ),
  ).rejects.toThrow();
});

it.each(['User', 'GithubUserActivityHistory'] as const)(
  '%s가 있는 DB에서 레포가 전부 사라져도 승인 건수 불일치로 중단한다',
  async (table) => {
    await inSchema((transaction) =>
      transaction.$executeRawUnsafe(
        table === 'User'
          ? `INSERT INTO "User" VALUES ('existing-user')`
          : `INSERT INTO "GithubUserActivityHistory" VALUES ('existing-activity', 1)`,
      ),
    );
    await expect(apply()).rejects.toThrow(
      'github scope retirement: GithubRepository expected 12, found 0',
    );
  },
);
