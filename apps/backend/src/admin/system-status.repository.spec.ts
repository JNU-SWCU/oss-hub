import { PlatformRepository } from '../platform/platform.repository';
import type { PrismaService } from '../platform/prisma.service';
import { SystemStatusRepository } from './system-status.repository';

describe('SystemStatusRepository', () => {
  const findMany = jest.fn();
  const repoFindMany = jest.fn();
  const leaseCount = jest.fn();
  const repository = new SystemStatusRepository(
    {
      githubRepository: { findMany },
      repo: { findMany: repoFindMany },
      collectionSyncLease: { count: leaseCount },
    } as unknown as PrismaService,
    new PlatformRepository(),
  );

  beforeEach(() => {
    findMany.mockReset();
    repoFindMany.mockReset();
    leaseCount.mockReset();
  });

  it('저장소마다 마지막 성공 시각을 repo 원장에서 github id로 찾는다', async () => {
    findMany.mockResolvedValue([
      {
        githubRepositoryId: 1n,
        nameWithOwner: 'org/alpha',
        team: { program: { name: '2026 오픈소스' } },
      },
      { githubRepositoryId: 2n, nameWithOwner: 'org/beta', team: null },
    ]);
    repoFindMany.mockResolvedValue([
      { githubRepoId: 1n, lastSuccessAt: new Date('2026-07-25T11:00:00Z') },
    ]);

    await expect(repository.getCollectionRepositories()).resolves.toEqual([
      {
        repositoryName: 'org/alpha',
        programName: '2026 오픈소스',
        lastSuccessAt: new Date('2026-07-25T11:00:00Z'),
      },
      { repositoryName: 'org/beta', programName: null, lastSuccessAt: null },
    ]);
    expect(repoFindMany).toHaveBeenCalledWith({
      where: { githubRepoId: { in: [1n, 2n] } },
      select: { githubRepoId: true, lastSuccessAt: true },
    });
  });

  it('만료 전인 수집 잠금만 실행 중으로 센다', async () => {
    const now = new Date('2026-07-25T12:00:00Z');
    leaseCount.mockResolvedValue(0);

    await expect(repository.hasActiveCollectionRun(now)).resolves.toBe(false);
    expect(leaseCount).toHaveBeenCalledWith({
      where: { expiresAt: { gt: now } },
    });
  });
});
