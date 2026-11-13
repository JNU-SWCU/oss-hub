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

  it('저장소마다 마지막 성공 시각과 열린 팀 연결의 프로그램을 repo 원장에서 읽는다', async () => {
    repoFindMany.mockResolvedValue([
      {
        ownerName: 'org/alpha',
        lastSuccessAt: new Date('2026-07-25T11:00:00Z'),
        teamRepos: [{ team: { program: { name: '2026 오픈소스' } } }],
      },
      { ownerName: 'org/beta', lastSuccessAt: null, teamRepos: [] },
    ]);

    await expect(repository.getCollectionRepositories()).resolves.toEqual([
      {
        repositoryName: 'org/alpha',
        programName: '2026 오픈소스',
        lastSuccessAt: new Date('2026-07-25T11:00:00Z'),
      },
      { repositoryName: 'org/beta', programName: null, lastSuccessAt: null },
    ]);
    expect(repoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          presence: 'PRESENT',
          source: 'ORG_PROVISIONED',
        }) as unknown,
        orderBy: { ownerName: 'asc' },
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
