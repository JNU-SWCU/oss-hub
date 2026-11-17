import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { loadPrismaPoolConfig } from './prisma-pool.config';
import { loadPrismaQueryLintConfig } from './prisma-query-lint.config';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const FILE = 'apps/backend/src/platform/prisma-query-lint.integration.spec.ts';
const base = new PrismaClient({
  adapter: new PrismaPg(loadPrismaPoolConfig()),
});
const prisma = loadPrismaQueryLintConfig().createLintedClient(base);

class LintProbeRepository {
  added() {
    return prisma.repo.findMany({ select: { githubRepoId: true } });
  }

  addedInTransaction() {
    return prisma.$transaction((tx) =>
      tx.repo.findMany({ select: { githubRepoId: true } }),
    );
  }

  addedInBatch() {
    return prisma.$transaction([
      prisma.repo.findMany({ select: { githubRepoId: true } }),
    ]);
  }
}

class LintProbeService {
  constructor(private readonly repository: LintProbeRepository) {}

  load() {
    return this.repository.added();
  }
}

afterAll(async () => {
  await base.$disconnect();
});

describe('Prisma query lint attribution against PostgreSQL', () => {
  const repository = new LintProbeRepository();

  it.each([
    ['added', () => repository.added(), 'added'],
    [
      'addedInTransaction',
      () => repository.addedInTransaction(),
      'addedInTransaction',
    ],
    ['addedInBatch', () => repository.addedInBatch(), 'addedInBatch'],
    [
      'a nested service call',
      () => new LintProbeService(repository).load(),
      'added',
    ],
  ])(
    'rejects a new unbounded read in %s of the same file',
    async (_, run, owner) => {
      await expect(run()).rejects.toMatchObject({
        code: 'LINT.NO_LIMIT',
        key: `Repo.findMany@${FILE}#LintProbeRepository.${owner}`,
      });
    },
  );
});
