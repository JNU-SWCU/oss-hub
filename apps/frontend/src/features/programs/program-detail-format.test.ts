import { describe, expect, it } from 'vitest';
import { isPastDue } from './program-detail-format';

describe('isPastDue', () => {
  const dueAt = '2026-09-19T18:00:00+09:00';

  it('같은 날짜라도 정확한 마감 시각이 지나면 닫는다', () => {
    expect(isPastDue(dueAt, Date.parse('2026-09-19T18:00:00+09:00'))).toBe(
      false,
    );
    expect(isPastDue(dueAt, Date.parse('2026-09-19T18:00:00.001+09:00'))).toBe(
      true,
    );
  });

  it('잘못된 날짜는 임의로 닫지 않고 서버 검증에 맡긴다', () => {
    expect(isPastDue('not-a-date', Date.now())).toBe(false);
  });
});
