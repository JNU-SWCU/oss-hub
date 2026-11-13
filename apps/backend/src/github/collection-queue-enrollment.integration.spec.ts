import { deleteGithubRepositories } from '../../test/repo-ledger.fixture';
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
  afterEach(() => deleteGithubRepositories(prisma, { githubRepositoryId }));
  afterAll(() => prisma.$disconnect());

  it('미등록 레포의 메타데이터 관찰은 레포를 생성하지 않는다', async () => {
    await expect(
      repository.refreshRepositoryObservation(observation),
    ).resolves.toBeNull();
    await expect(
      prisma.githubRepository.count({ where: { githubRepositoryId } }),
    ).resolves.toBe(0);
  });

  it('기존 레포의 메타데이터를 갱신하면서 재시도 일정을 보존한다', async () => {
    const retryAt = new Date('2099-01-01T00:00:00.000Z');
    await prisma.githubRepository.create({
      data: {
        githubRepositoryId,
        nameWithOwner: observation.nameWithOwner,
        source: observation.source,
        defaultBranch: 'main',
        nextRunAt: retryAt,
        failureCount: 3,
      },
    });

    await repository.refreshRepositoryObservation(observation);

    await expect(
      prisma.githubRepository.findUniqueOrThrow({
        where: { githubRepositoryId },
      }),
    ).resolves.toMatchObject({
      defaultBranch: 'trunk',
      nextRunAt: retryAt,
      failureCount: 3,
    });
  });

  it.each(['ORG_PROVISIONED', 'EXTERNAL_PUBLIC'] as const)(
    '팀 지원에서 분리된 %s 저장소는 수집 목록에서 제외한다',
    async (source) => {
      await prisma.githubRepository.create({
        data: {
          githubRepositoryId,
          nameWithOwner: observation.nameWithOwner,
          source,
          presence: 'PRESENT',
        },
      });

      const selected =
        source === 'ORG_PROVISIONED'
          ? await repository.listOrganizationRepositories()
          : await repository.listExternalRepositories();

      expect(selected.map((row) => row.githubRepositoryId)).not.toContain(
        githubRepositoryId,
      );
    },
  );
});
