import {
  rankingYearInAsiaSeoul,
  rankingYearStartInAsiaSeoul,
} from './ranking-event';

describe('ranking period boundaries', () => {
  it('uses midnight on January 1 in Asia/Seoul as the exact year boundary', () => {
    expect(rankingYearInAsiaSeoul(new Date('2025-12-31T14:59:59.999Z'))).toBe(
      2025,
    );
    expect(rankingYearInAsiaSeoul(new Date('2025-12-31T15:00:00.000Z'))).toBe(
      2026,
    );
    expect(rankingYearStartInAsiaSeoul(2026)).toEqual(
      new Date('2025-12-31T15:00:00.000Z'),
    );
  });
});
