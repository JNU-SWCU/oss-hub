import type { PrismaService } from '../../prisma/prisma.service';
import { ProgramMetricsRepository } from './program-metrics.repository';

describe('ProgramMetricsRepository.getContributorCumulativeMetrics', () => {
  it('drops a contributor who only opened issues and keeps everyone else with their sums', async () => {
    // Given — #1133: a day with only issues leaves a row whose commit, PR and release counts are 0.
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
        findMany: jest.fn().mockResolvedValue([
          row(1n, [2, 0, 0]),
          row(1n, [0, 0, 0]), // an issue-only day of someone with commits
          row(2n, [0, 0, 0]), // only ever opened issues
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

    // When
    const result = await new ProgramMetricsRepository(
      prisma as unknown as PrismaService,
    ).getContributorCumulativeMetrics({ repositoryIds: [101n] });

    // Then
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
