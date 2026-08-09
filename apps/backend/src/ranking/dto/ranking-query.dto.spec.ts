import 'reflect-metadata';
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
  resolveRankingQueryYear,
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
    // 학생이 처음 여는 화면은 "올해 내 활동"이다(ADR-010 §1).
    expect(resolveRankingQueryYear({}, fixedNow)).toBe(2026);
  });
});
