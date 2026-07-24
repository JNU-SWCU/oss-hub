import { RANKING_NOTICE, RANKING_PERIODS } from './domain/ranking';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';

describe('RankingController', () => {
  const findPage = jest.fn();
  const controller = new RankingController({
    findPage,
  } as unknown as RankingService);

  beforeEach(() => {
    findPage.mockReset();
  });

  it('공개 API 계약 형태로 서비스 결과를 전달한다', async () => {
    findPage.mockResolvedValue({
      notice: RANKING_NOTICE,
      period: RANKING_PERIODS.THIS_YEAR,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          commitCount: 2,
          prCount: 1,
          starCount: 0,
          total: 3,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    await expect(
      controller.findPage({
        period: RANKING_PERIODS.THIS_YEAR,
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual({
      notice: RANKING_NOTICE,
      period: RANKING_PERIODS.THIS_YEAR,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          commitCount: 2,
          prCount: 1,
          starCount: 0,
          total: 3,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(findPage).toHaveBeenCalledWith(RANKING_PERIODS.THIS_YEAR, 1, 20);
  });
});
