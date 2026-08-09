import { HEADERS_METADATA } from '@nestjs/common/constants';
import { RANKING_YEAR_ALL } from '../domain/ranking';
import { RankingController } from './ranking.controller';
import { RankingService } from '../service/ranking.service';

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

  it('공개 랭킹과 연도 목록은 공개 회수 전 응답을 저장하지 않는다', () => {
    for (const methodName of ['findPage', 'listYears'] as const) {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        RankingController.prototype,
        methodName,
      )?.value;
      if (typeof handler !== 'function') {
        throw new TypeError(`RankingController.${methodName} is missing`);
      }
      expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([
        { name: 'Cache-Control', value: 'no-store' },
      ]);
    }
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
          pullRequestCount: 1,
          releaseCount: 0,
          total: 3,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      dataAsOf: null,
    });

    await expect(
      controller.findPage({
        year: '2026',
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual({
      year: 2026,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          commitCount: 2,
          pullRequestCount: 1,
          releaseCount: 0,
          total: 3,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      dataAsOf: null,
    });
    expect(findPage).toHaveBeenCalledWith(2026, 1, 20);
  });

  it('year 기본은 올해이고 legacy period=ALL 은 전체로 남는다', async () => {
    findPage.mockResolvedValue({
      year: RANKING_YEAR_ALL,
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      dataAsOf: null,
    });

    await controller.findPage({
      page: 1,
      pageSize: 20,
    });
    // 기본은 올해다(ADR-010 §1) — 명시적 ALL 만 전체 누적으로 간다.
    expect(findPage).toHaveBeenLastCalledWith(new Date().getFullYear(), 1, 20);

    findPage.mockResolvedValue({
      year: 2026,
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      dataAsOf: null,
    });
    const now = new Date('2026-07-21T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(now);
    try {
      await controller.findPage({
        period: 'THIS_YEAR',
        page: 1,
        pageSize: 20,
      });
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
