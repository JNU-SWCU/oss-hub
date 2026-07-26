import { PrismaService } from '../prisma/prisma.service';
import { RANKING_PERIODS } from './domain/ranking';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';

const projection = (
  githubUserId: bigint,
  githubLogin: string,
  commitCount: number,
  pullRequestCount: number,
  releaseCount: number,
  currentYearCommitCount = commitCount,
  currentYearPullRequestCount = pullRequestCount,
  currentYearReleaseCount = releaseCount,
) => ({
  githubUserId,
  githubLogin,
  commitCount,
  pullRequestCount,
  releaseCount,
  currentYearCommitCount,
  currentYearPullRequestCount,
  currentYearReleaseCount,
});

describe('RankingRepository canonical reader', () => {
  function setup() {
    const canonicalContributorProjection = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      canonicalContributorProjection,
    } as unknown as PrismaService;
    return {
      repository: new RankingRepository(prisma),
      prisma: prisma as unknown as Record<string, unknown>,
      canonicalContributorProjection,
    };
  }

  it('reads and aggregates only active-generation contributor projections for all time', async () => {
    const harness = setup();
    harness.canonicalContributorProjection.findMany.mockResolvedValue([
      projection(1n, 'Mina', 2, 1, 0),
      projection(1n, 'mina', 3, 0, 1),
    ]);

    await expect(harness.repository.findCanonicalActivity()).resolves.toEqual([
      {
        githubId: 1n,
        githubLogin: 'Mina',
        commitCount: 5,
        prCount: 1,
        releaseCount: 1,
      },
    ]);
    expect(
      harness.canonicalContributorProjection.findMany,
    ).toHaveBeenCalledWith({
      where: { generation: { activeFor: { some: {} } } },
      select: {
        githubUserId: true,
        githubLogin: true,
        commitCount: true,
        pullRequestCount: true,
        releaseCount: true,
        currentYearCommitCount: true,
        currentYearPullRequestCount: true,
        currentYearReleaseCount: true,
      },
    });
    expect(harness.prisma).not.toHaveProperty('canonicalDefaultBranchCommit');
    expect(harness.prisma).not.toHaveProperty('canonicalPullRequest');
    expect(harness.prisma).not.toHaveProperty('canonicalRelease');
  });

  it('reads the matching projection year and uses current-year metrics', async () => {
    const harness = setup();
    harness.canonicalContributorProjection.findMany.mockResolvedValue([
      projection(2n, 'Jin', 10, 8, 6, 3, 2, 1),
    ]);

    await expect(
      harness.repository.findCanonicalActivity(2026),
    ).resolves.toEqual([
      {
        githubId: 2n,
        githubLogin: 'Jin',
        commitCount: 3,
        prCount: 2,
        releaseCount: 1,
      },
    ]);
    expect(
      harness.canonicalContributorProjection.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          generation: { activeFor: { some: {} } },
          currentYear: 2026,
        },
      }),
    );
  });
});

describe('RankingService deterministic ordering', () => {
  it('orders every tie level and uses normalized login then numeric GitHub id', async () => {
    const findCanonicalActivity = jest.fn().mockResolvedValue([
      {
        githubId: 20n,
        githubLogin: 'z',
        commitCount: 2,
        prCount: 1,
        releaseCount: 1,
      },
      {
        githubId: 21n,
        githubLogin: 'a',
        commitCount: 3,
        prCount: 0,
        releaseCount: 1,
      },
      {
        githubId: 22n,
        githubLogin: 'b',
        commitCount: 3,
        prCount: 1,
        releaseCount: 0,
      },
      {
        githubId: 23n,
        githubLogin: 'c',
        commitCount: 3,
        prCount: 1,
        releaseCount: 1,
      },
      {
        githubId: 10n,
        githubLogin: 'Same',
        commitCount: 3,
        prCount: 1,
        releaseCount: 1,
      },
      {
        githubId: 2n,
        githubLogin: 'same',
        commitCount: 3,
        prCount: 1,
        releaseCount: 1,
      },
      {
        githubId: 30n,
        githubLogin: 'top',
        commitCount: 6,
        prCount: 0,
        releaseCount: 0,
      },
    ]);
    const service = new RankingService({
      findCanonicalActivity,
    } as unknown as RankingRepository);

    const page = await service.findPage(
      RANKING_PERIODS.ALL,
      1,
      20,
      new Date('2026-06-01T00:00:00.000Z'),
    );

    expect(page.items.map((item) => item.githubLogin)).toEqual([
      'top',
      'c',
      'same',
      'Same',
      'b',
      'a',
      'z',
    ]);
    expect(page.items[0]).not.toHaveProperty('starCount');
  });
});
