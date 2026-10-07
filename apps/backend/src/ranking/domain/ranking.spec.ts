import {
  LEGACY_RANKING_PERIODS,
  RANKING_YEAR_ALL,
  resolveRankingYearFromQuery,
} from './ranking';

describe('resolveRankingYearFromQuery', () => {
  const now = new Date('2026-07-21T00:00:00.000Z');

  it('prefers year over legacy period', () => {
    expect(
      resolveRankingYearFromQuery(2025, LEGACY_RANKING_PERIODS.ALL, now),
    ).toBe(2025);
    expect(
      resolveRankingYearFromQuery(
        RANKING_YEAR_ALL,
        LEGACY_RANKING_PERIODS.THIS_YEAR,
        now,
      ),
    ).toBe(RANKING_YEAR_ALL);
  });

  it('maps legacy THIS_YEAR to Asia/Seoul calendar year', () => {
    expect(
      resolveRankingYearFromQuery(
        undefined,
        LEGACY_RANKING_PERIODS.THIS_YEAR,
        now,
      ),
    ).toBe(2026);

    expect(
      resolveRankingYearFromQuery(
        undefined,
        LEGACY_RANKING_PERIODS.THIS_YEAR,
        new Date('2025-12-31T15:00:00.000Z'),
      ),
    ).toBe(2026);
  });

  it('legacy ALL 은 전체이되 기본값은 올해다', () => {
    expect(
      resolveRankingYearFromQuery(undefined, LEGACY_RANKING_PERIODS.ALL, now),
    ).toBe(RANKING_YEAR_ALL);

    expect(resolveRankingYearFromQuery(undefined, undefined, now)).toBe(2026);
  });
});
