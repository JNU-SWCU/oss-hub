import { RANKING_YEAR_ALL } from './domain/ranking';
import type { RankingQueryRequestDto } from './dto/ranking-query.dto';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';

describe('RankingController', () => {
  const findPage = jest.fn();
  const listYears = jest.fn();
  const controller = new RankingController({
    findPage,
    listYears,
  } as unknown as RankingService);

  beforeEach(() => {
    findPage.mockReset();
    listYears.mockReset();
  });

  it('공개 API 계약 형태로 서비스 결과를 전달한다', async () => {
    findPage.mockResolvedValue({
      year: 2026,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          commitCount: 2,
          prCount: 1,
          releaseCount: 0,
          total: 3,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    await expect(
      controller.findPage({
        year: '2026',
        page: 1,
        pageSize: 20,
      } as RankingQueryRequestDto),
    ).resolves.toEqual({
      year: 2026,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          commitCount: 2,
          prCount: 1,
          releaseCount: 0,
          total: 3,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(findPage).toHaveBeenCalledWith(2026, 1, 20);
  });

  it('year 기본은 all 이고 legacy period=THIS_YEAR는 현재 연도로 매핑한다', async () => {
    findPage.mockResolvedValue({
      year: RANKING_YEAR_ALL,
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });

    await controller.findPage({
      page: 1,
      pageSize: 20,
    } as RankingQueryRequestDto);
    expect(findPage).toHaveBeenLastCalledWith(RANKING_YEAR_ALL, 1, 20);

    findPage.mockResolvedValue({
      year: 2026,
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    const now = new Date('2026-07-21T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(now);
    try {
      await controller.findPage({
        period: 'THIS_YEAR',
        page: 1,
        pageSize: 20,
      } as RankingQueryRequestDto);
      expect(findPage).toHaveBeenLastCalledWith(2026, 1, 20);
    } finally {
      jest.useRealTimers();
    }
  });

  it('GET /ranking/years 는 연도 목록을 전달한다', async () => {
    listYears.mockResolvedValue([2026, 2025]);

    await expect(controller.listYears()).resolves.toEqual({
      years: [2026, 2025],
    });
    expect(listYears).toHaveBeenCalledTimes(1);
  });
});
