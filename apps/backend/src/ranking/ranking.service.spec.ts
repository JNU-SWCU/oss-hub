import { RANKING_NOTICE, RANKING_PERIODS } from './domain/ranking';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';

function event(
  id: string,
  targetLogin: string,
  type: string,
  action: string | null,
  repositoryId: number,
  createdAt: string,
  size?: number,
) {
  return {
    sourceId: id,
    targetLogin,
    payload: {
      type,
      created_at: createdAt,
      repo: { id: repositoryId },
      payload: {
        ...(action ? { action } : {}),
        ...(size === undefined ? {} : { size }),
        commits: [{ sha: 'must-not-be-counted' }, { sha: 'also-ignored' }],
      },
    },
  };
}

describe('RankingService', () => {
  const findSourceData = jest.fn();
  const repository = { findSourceData } as unknown as RankingRepository;
  const service = new RankingService(repository);

  beforeEach(() => {
    findSourceData.mockReset();
  });

  it('연결 저장소의 Push size, PR opened, Watch started만 한 번씩 집계한다', async () => {
    findSourceData.mockResolvedValue({
      platformRepositoryIds: ['101'],
      observations: [
        event(
          'push-1',
          'mina',
          'PushEvent',
          null,
          101,
          '2026-07-01T00:00:00.000Z',
          5,
        ),
        event(
          'pr-1',
          'mina',
          'PullRequestEvent',
          'opened',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
        event(
          'star-1',
          'june',
          'WatchEvent',
          'started',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
        event(
          'push-1',
          'mina',
          'PushEvent',
          null,
          101,
          '2026-07-01T00:00:00.000Z',
          99,
        ),
        event(
          'pr-closed',
          'mina',
          'PullRequestEvent',
          'closed',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
        event(
          'external',
          'mina',
          'WatchEvent',
          'started',
          999,
          '2026-07-01T00:00:00.000Z',
        ),
      ],
    });

    await expect(
      service.findPage(
        RANKING_PERIODS.THIS_YEAR,
        1,
        20,
        new Date('2026-07-21T00:00:00.000Z'),
      ),
    ).resolves.toEqual({
      notice: RANKING_NOTICE,
      period: RANKING_PERIODS.THIS_YEAR,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          commitCount: 5,
          prCount: 1,
          starCount: 0,
          total: 6,
        },
        {
          rank: 2,
          displayName: 'june',
          githubLogin: 'june',
          commitCount: 0,
          prCount: 0,
          starCount: 1,
          total: 1,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
  });

  it('올해 필터와 전체 필터, 페이지 경계를 적용한다', async () => {
    findSourceData.mockResolvedValue({
      platformRepositoryIds: ['101'],
      observations: [
        event(
          'this-year',
          'mina',
          'PushEvent',
          null,
          101,
          '2026-01-01T00:00:00.000Z',
          2,
        ),
        event(
          'last-year',
          'june',
          'WatchEvent',
          'started',
          101,
          '2025-12-31T23:59:59.000Z',
        ),
      ],
    });

    await expect(
      service.findPage(
        RANKING_PERIODS.THIS_YEAR,
        2,
        1,
        new Date('2026-07-21T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ items: [], page: 2, pageSize: 1, total: 1 });
    await expect(
      service.findPage(
        RANKING_PERIODS.ALL,
        1,
        20,
        new Date('2026-07-21T00:00:00.000Z'),
      ),
    ).resolves.toEqual({
      notice: RANKING_NOTICE,
      period: RANKING_PERIODS.ALL,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          commitCount: 2,
          prCount: 0,
          starCount: 0,
          total: 2,
        },
        {
          rank: 2,
          displayName: 'june',
          githubLogin: 'june',
          commitCount: 0,
          prCount: 0,
          starCount: 1,
          total: 1,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
  });
});
