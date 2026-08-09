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
    // 2025-12-31 15:00Z == 2026-01-01 00:00 KST
    expect(
      resolveRankingYearFromQuery(
        undefined,
        LEGACY_RANKING_PERIODS.THIS_YEAR,
        new Date('2025-12-31T15:00:00.000Z'),
      ),
    ).toBe(2026);
  });

  it('legacy ALL 은 전체이되 기본값은 올해다', () => {
    // 명시적 ALL 은 그대로 전체 누적이다 — 기존 링크가 깨지지 않는다.
    expect(
      resolveRankingYearFromQuery(undefined, LEGACY_RANKING_PERIODS.ALL, now),
    ).toBe(RANKING_YEAR_ALL);
    // 아무 것도 지정하지 않으면 올해다(ADR-010 §1). 전체 누적이 기본이면
    // 먼저 들어온 학생이 영구히 위에 남아 신입생 활동이 화면에서 보이지 않는다.
    expect(resolveRankingYearFromQuery(undefined, undefined, now)).toBe(2026);
  });
});
