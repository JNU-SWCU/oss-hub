import { describe, expect, it } from 'vitest';
import { formatSeoulShortRange, isPastDue } from './program-detail-format';

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

describe('formatSeoulShortRange', () => {
  it('시작 날짜와 마감 날짜·시각을 서울 시각으로 한 줄에 적는다', () => {
    expect(
      formatSeoulShortRange(
        '2026-08-04T16:58:00.000Z',
        '2026-08-05T16:58:00.000Z',
      ),
    ).toBe('26.08.05 – 26.08.06 01:58');
  });

  it('날짜 경계와 연도는 서울 기준으로 자른다', () => {
    expect(
      formatSeoulShortRange(
        '2026-12-31T15:00:00.000Z',
        '2027-01-01T14:59:00.000Z',
      ),
    ).toBe('27.01.01 – 27.01.01 23:59');
  });
});
