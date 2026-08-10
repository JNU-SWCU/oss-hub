import { describe, expect, it } from 'vitest';

import {
  formatDashboardDeadline,
  formatDashboardDeadlineAbsolute,
} from './deadline';

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

describe('formatDashboardDeadlineAbsolute', () => {
  it.each([
    ['2026-08-26T23:59:59+09:00', '8월 26일 23:59 마감'],
    ['2026-01-05T00:00:00+09:00', '1월 5일 00:00 마감'],
    ['2026-08-01T00:30:00+09:00', '8월 1일 00:30 마감'],
    ['2026-08-26T14:59:00Z', '8월 26일 23:59 마감'],
  ])('Asia/Seoul 실제 마감 일시로 %s를 %s로 표시한다', (dueAt, label) => {
    expect(formatDashboardDeadlineAbsolute(dueAt)).toBe(label);
  });
});
