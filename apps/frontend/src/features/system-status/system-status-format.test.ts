import { describe, expect, it } from 'vitest';
import { formatRelativeTime, formatStamp } from './system-status-format';

describe('formatStamp', () => {
  it('서울 시각을 월.일 시:분으로 적는다', () => {
    expect(formatStamp('2026-11-17T00:12:00.000Z')).toBe('11.17 09:12');
  });

  it('자정 직후를 24시가 아니라 00시로 적는다', () => {
    expect(formatStamp('2026-11-16T15:05:00.000Z')).toBe('11.17 00:05');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-17T00:32:00.000Z');

  it.each([
    ['2026-11-17T00:00:00.000Z', '32분 전'],
    ['2026-11-17T01:00:00.000Z', '28분 후'],
    ['2026-11-16T21:32:00.000Z', '3시간 전'],
    ['2026-11-17T00:31:30.000Z', '방금 전'],
  ])('%s을 기준 시각에서 본 상대 시각으로 적는다', (value, expected) => {
    expect(formatRelativeTime(value, now)).toBe(expected);
  });
});
