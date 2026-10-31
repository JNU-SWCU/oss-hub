import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  LEGACY_RANKING_PERIODS,
  RANKING_YEAR_ALL,
  RANKING_YEAR_MAX,
  RANKING_YEAR_MIN,
} from '../domain/ranking';
import {
  RankingQueryRequestDto,
  RankingTimelineQueryRequestDto,
  resolveRankingQueryYear,
  resolveRankingTimelineQueryYear,
} from './ranking-query.dto';

async function validateYear(year: string | undefined) {
  const query = plainToInstance(RankingQueryRequestDto, {
    year,
    page: '1',
    pageSize: '20',
  });
  return validate(query);
}

describe('RankingQueryRequestDto year range (Q3)', () => {
  it.each(['2026', '2000', '2100', 'all', 'ALL'] as const)(
    'accepts year=%s',
    async (year) => {
      const errors = await validateYear(year);
      expect(errors).toHaveLength(0);
    },
  );

  it.each(['0000', '9999', '1999', '2101'] as const)(
    'rejects out-of-range year=%s',
    async (year) => {
      const errors = await validateYear(year);
      expect(errors.some((error) => error.property === 'year')).toBe(true);
    },
  );

  it('exports ranking year bounds as 2000–2100', () => {
    expect(RANKING_YEAR_MIN).toBe(2000);
    expect(RANKING_YEAR_MAX).toBe(2100);
  });
});

describe('RankingTimelineQueryRequestDto year', () => {
  async function validateTimelineYear(year: string | undefined) {
    return validate(plainToInstance(RankingTimelineQueryRequestDto, { year }));
  }

  it.each(['2026', '2000', '2100', undefined] as const)(
    'accepts year=%s',
    async (year) => {
      expect(await validateTimelineYear(year)).toHaveLength(0);
    },
  );

  it.each(['all', 'ALL', '1999', '2101', 'abc'] as const)(
    'rejects year=%s',
    async (year) => {
      const errors = await validateTimelineYear(year);
      expect(errors.some((error) => error.property === 'year')).toBe(true);
    },
  );
});

describe('resolveRankingTimelineQueryYear', () => {
  it('year 가 없으면 Asia/Seoul 올해를, 있으면 그 연도를 정수로 돌려준다', () => {
    expect(
      resolveRankingTimelineQueryYear({}, new Date('2026-12-31T15:30:00.000Z')),
    ).toBe(2027);
    expect(resolveRankingTimelineQueryYear({ year: '2026' })).toBe(2026);
  });

  it.each([RANKING_YEAR_ALL, 'abc', '1999', '2101'])(
    'year=%s 는 BadRequestException 이다',
    (year) => {
      expect(() => resolveRankingTimelineQueryYear({ year })).toThrow(
        BadRequestException,
      );
    },
  );
});

describe('resolveRankingQueryYear (Q5)', () => {
  const fixedNow = new Date('2026-07-21T00:00:00.000Z');

  it('maps legacy period=THIS_YEAR to Asia/Seoul calendar year', () => {
    expect(
      resolveRankingQueryYear(
        { period: LEGACY_RANKING_PERIODS.THIS_YEAR },
        fixedNow,
      ),
    ).toBe(2026);
  });

  it('maps legacy period=ALL to all', () => {
    expect(
      resolveRankingQueryYear({ period: LEGACY_RANKING_PERIODS.ALL }, fixedNow),
    ).toBe(RANKING_YEAR_ALL);
  });

  it('prefers year over period', () => {
    expect(
      resolveRankingQueryYear(
        { year: '2025', period: LEGACY_RANKING_PERIODS.ALL },
        fixedNow,
      ),
    ).toBe(2025);
    expect(
      resolveRankingQueryYear(
        { year: 'all', period: LEGACY_RANKING_PERIODS.THIS_YEAR },
        fixedNow,
      ),
    ).toBe(RANKING_YEAR_ALL);
  });

  it('year·period 가 모두 없으면 올해로 본다', () => {
    expect(resolveRankingQueryYear({}, fixedNow)).toBe(2026);
  });
});
