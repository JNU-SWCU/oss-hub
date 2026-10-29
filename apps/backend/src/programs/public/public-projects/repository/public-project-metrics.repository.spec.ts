import type { PrismaService } from '../../../../prisma/prisma.service';
import { PublicProjectMetricsRepository } from './public-project-metrics.repository';

describe('PublicProjectMetricsRepository.getContributorCumulativeMetrics', () => {
  it('drops a contributor who only opened issues and keeps everyone else with their sums', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00.000Z');
    const row = (
      githubId: bigint,
      [commitCount, pullRequestCount, releaseCount]: readonly number[],
    ) => ({
      githubId,
      commitCount,
      pullRequestCount,
      releaseCount,
      updatedAt,
      repository: { githubRepositoryId: 101n },
    });
    const prisma = {
      contribution: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            row(1n, [2, 0, 0]),
            row(1n, [0, 0, 0]),
            row(2n, [0, 0, 0]),
            row(3n, [0, 0, 1]),
          ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { githubId: 1n, nickname: 'synthetic-committer' },
          { githubId: 3n, nickname: 'synthetic-releaser' },
        ]),
      },
    };

    const result = await new PublicProjectMetricsRepository(
      prisma as unknown as PrismaService,
    ).getContributorCumulativeMetrics({ repositoryIds: [101n] });

    expect(result).toEqual([
      {
        repositoryId: 101n,
        githubUserId: 1n,
        githubLogin: 'synthetic-committer',
        dataAsOf: updatedAt,
        commitCount: 2,
        pullRequestCount: 0,
        releaseCount: 0,
      },
      {
        repositoryId: 101n,
        githubUserId: 3n,
        githubLogin: 'synthetic-releaser',
        dataAsOf: updatedAt,
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 1,
      },
    ]);
  });
});
