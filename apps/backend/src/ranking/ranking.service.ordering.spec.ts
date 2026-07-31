import type {
  CollectionRankingActivityDto,
  CollectionRankingActivityQueryDto,
  CollectionReadPort,
} from '../collection/collection-read.port';
import { RANKING_PERIODS } from './domain/ranking';
import { RankingService } from './ranking.service';

describe('RankingService deterministic ordering', () => {
  it('orders every tie level and uses normalized login then numeric GitHub id', async () => {
    const findRankingActivity = jest.fn<
      Promise<readonly CollectionRankingActivityDto[]>,
      [CollectionRankingActivityQueryDto]
    >();
    findRankingActivity.mockResolvedValue([
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
    const collection = {
      findRepositoryActivity: () => Promise.resolve([]),
      findRankingActivity,
      getStatusSnapshot: () => Promise.resolve(null),
    } satisfies CollectionReadPort;
    const service = new RankingService(collection);

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
