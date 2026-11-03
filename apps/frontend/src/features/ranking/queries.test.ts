import { describe, expect, it } from 'vitest';
import { RANKING_POLL_MS, rankingRefetchDelay } from './queries';

describe('rankingRefetchDelay', () => {
  const now = Date.parse('2026-11-03T05:00:00.000Z');

  it('다음 수집 시각이 5분 안이면 그 시각에 다시 조회한다', () => {
    expect(rankingRefetchDelay('2026-11-03T05:02:00.000Z', now)).toBe(120_000);
  });

  it('다음 수집 시각이 멀면 5분마다 다시 조회한다', () => {
    expect(rankingRefetchDelay('2026-11-03T05:53:22.000Z', now)).toBe(
      RANKING_POLL_MS,
    );
  });

  it('다음 수집 시각이 지났거나 없으면 멈추지 않고 다시 조회한다', () => {
    expect(rankingRefetchDelay('2026-11-03T04:59:00.000Z', now)).toBe(1_000);
    expect(rankingRefetchDelay(null, now)).toBe(RANKING_POLL_MS);
  });
});
