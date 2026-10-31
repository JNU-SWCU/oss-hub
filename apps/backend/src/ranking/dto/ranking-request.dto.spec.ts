import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RankingRequestDto } from './ranking-request.dto';
import {
  RankingYearService,
  LEGACY_RANKING_PERIODS,
  RANKING_YEAR_ALL,
  RANKING_YEAR_MAX,
  RANKING_YEAR_MIN,
} from '../ranking-year.service';

const rankingYearService = new RankingYearService();

async function validateYear(year: string | undefined) {
  const query = plainToInstance(RankingRequestDto, {
    year,
    page: '1',
    pageSize: '20',
  });
  return validate(query);
}

describe('RankingRequestDto year range (Q3)', () => {
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
      rankingYearService.resolveRankingQueryYear(
        { period: LEGACY_RANKING_PERIODS.THIS_YEAR },
        fixedNow,
      ),
    ).toBe(2026);
  });

  it('maps legacy period=ALL to all', () => {
    expect(
      rankingYearService.resolveRankingQueryYear(
        { period: LEGACY_RANKING_PERIODS.ALL },
        fixedNow,
      ),
    ).toBe(RANKING_YEAR_ALL);
  });

  it('prefers year over period', () => {
    expect(
      rankingYearService.resolveRankingQueryYear(
        { year: '2025', period: LEGACY_RANKING_PERIODS.ALL },
        fixedNow,
      ),
    ).toBe(2025);
    expect(
      rankingYearService.resolveRankingQueryYear(
        { year: 'all', period: LEGACY_RANKING_PERIODS.THIS_YEAR },
        fixedNow,
      ),
    ).toBe(RANKING_YEAR_ALL);
  });

  it('year·period 가 모두 없으면 올해로 본다', () => {
    expect(rankingYearService.resolveRankingQueryYear({}, fixedNow)).toBe(2026);
  });
});
