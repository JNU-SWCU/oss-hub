import { deleteRepos, seedRepo } from '../../test/repo-ledger.fixture';
import { PlatformRepository } from '../platform/platform.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { CollectionIncrementalRepository } from './collection-incremental.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new CollectionIncrementalRepository(
  prisma,
  new PlatformRepository(),
);
const githubRepositoryId = 9_000_000_146_301n;
const observation = {
  githubRepositoryId,
  nameWithOwner: 'synthetic-queue/observed',
  defaultBranch: 'trunk',
  archived: false,
  visibility: 'PUBLIC' as const,
  source: 'ORG_PROVISIONED' as const,
  observedAt: new Date('2026-08-09T14:00:00.000Z'),
};

describe('registered repository observation', () => {
  beforeAll(() => prisma.$connect());
  afterEach(() => deleteRepos(prisma, [githubRepositoryId]));
  afterAll(() => prisma.$disconnect());

  it('미등록 레포의 메타데이터 관찰은 레포를 생성하지 않는다', async () => {
    await expect(
      repository.refreshRepositoryObservation(observation),
    ).resolves.toBeNull();
    await expect(
      prisma.repo.count({ where: { githubRepoId: githubRepositoryId } }),
    ).resolves.toBe(0);
  });

  it('기존 레포의 메타데이터를 갱신한다', async () => {
    await seedRepo(prisma, {
      githubRepositoryId,
      nameWithOwner: observation.nameWithOwner,
      source: observation.source,
      defaultBranch: 'main',
    });

    await repository.refreshRepositoryObservation(observation);

    await expect(
      prisma.repo.findUniqueOrThrow({
        where: { githubRepoId: githubRepositoryId },
      }),
    ).resolves.toMatchObject({ defaultBranch: 'trunk' });
  });

  it.each(['ORG_PROVISIONED', 'EXTERNAL_PUBLIC'] as const)(
    '팀 지원에서 분리된 %s 저장소는 수집 목록에서 제외한다',
    async (source) => {
      await seedRepo(prisma, {
        githubRepositoryId,
        nameWithOwner: observation.nameWithOwner,
        source,
        presence: 'PRESENT',
      });

      const selected = await repository.listCollectionTargets(source);

      expect(selected.map((row) => row.githubRepositoryId)).not.toContain(
        githubRepositoryId,
      );
    },
  );
});
