import { RANKING_PERIODS } from './ranking';
import { isWithinRankingPeriod } from './ranking-event';

describe('ranking event period', () => {
  it('classifies THIS_YEAR boundaries by Asia/Seoul calendar year', () => {
    expect(
      isWithinRankingPeriod(
        new Date('2025-12-31T14:59:59.000Z'),
        RANKING_PERIODS.THIS_YEAR,
        2026,
      ),
    ).toBe(false);
    expect(
      isWithinRankingPeriod(
        new Date('2025-12-31T15:00:00.000Z'),
        RANKING_PERIODS.THIS_YEAR,
        2026,
      ),
    ).toBe(true);
  });
});
