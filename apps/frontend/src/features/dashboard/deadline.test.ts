import { describe, expect, it } from 'vitest';

import { formatDashboardDeadline } from './deadline';

describe('formatDashboardDeadline', () => {
  const now = new Date('2026-07-23T23:30:00+09:00');

  it.each([
    ['2026-07-26T00:00:00+09:00', 'D-3'],
    ['2026-07-23T00:01:00+09:00', 'D-Day'],
    ['2026-07-21T23:59:59+09:00', 'D+2'],
    ['2026-07-24T00:00:00Z', 'D-1'],
  ])('Asia/Seoul 달력 날짜로 %s를 %s로 표시한다', (dueAt, label) => {
    expect(formatDashboardDeadline(dueAt, now)).toBe(label);
  });
});
