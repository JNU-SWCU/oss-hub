import { PlatformRepository } from '../platform/platform.repository';
import type { PrismaService } from '../platform/prisma.service';
import { SystemStatusRepository } from './system-status.repository';

describe('SystemStatusRepository', () => {
  const repoFindMany = jest.fn();
  const leaseCount = jest.fn();
  const repository = new SystemStatusRepository(
    {
      repo: { findMany: repoFindMany },
      collectionSyncLease: { count: leaseCount },
    } as unknown as PrismaService,
    new PlatformRepository(),
  );

  beforeEach(() => {
    repoFindMany.mockReset();
    leaseCount.mockReset();
  });

  it('지연 저장소 한 페이지를 오래된 성공 순으로 읽고 열린 팀 연결의 프로그램을 싣는다', async () => {
    const staleBefore = new Date('2026-07-25T10:00:00Z');
    repoFindMany.mockResolvedValue([
      {
        ownerName: 'org/alpha',
        lastSuccessAt: new Date('2026-07-25T08:00:00Z'),
        teamRepos: [{ team: { program: { name: '2026 오픈소스' } } }],
      },
      {
        ownerName: 'org/beta',
        lastSuccessAt: new Date('2026-07-25T09:00:00Z'),
        teamRepos: [],
      },
    ]);

    await expect(
      repository.listStaleCollectionRepositories(staleBefore, {
        page: 3,
        limit: 10,
      }),
    ).resolves.toEqual([
      {
        repositoryName: 'org/alpha',
        programName: '2026 오픈소스',
        lastSuccessAt: new Date('2026-07-25T08:00:00Z'),
      },
      {
        repositoryName: 'org/beta',
        programName: null,
        lastSuccessAt: new Date('2026-07-25T09:00:00Z'),
      },
    ]);
    expect(repoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        skip: 20,
        where: expect.objectContaining({
          presence: 'PRESENT',
          source: 'ORG_PROVISIONED',
          lastSuccessAt: { lt: staleBefore },
        }) as unknown,
        orderBy: [{ lastSuccessAt: 'asc' }, { githubRepoId: 'asc' }],
      }),
    );
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
