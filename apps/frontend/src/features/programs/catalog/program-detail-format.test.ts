import { describe, expect, it } from 'vitest';
import {
  formatSeoulDateRange,
  formatSeoulShortRange,
  isPastDue,
  milestoneCountdown,
  programDetailContext,
} from './program-detail-format';

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

describe('milestoneCountdown', () => {
  it('마감 나흘 전까지는 남은 날을 여유 있는 단계로 적는다', () => {
    expect(milestoneCountdown(10, false)).toEqual({
      label: 'D-10',
      tone: 'ahead',
    });
    expect(milestoneCountdown(4, false)).toEqual({
      label: 'D-4',
      tone: 'ahead',
    });
  });

  it('마감 사흘 전부터 당일까지는 임박으로 적는다', () => {
    expect(milestoneCountdown(3, false)).toEqual({
      label: 'D-3',
      tone: 'soon',
    });
    expect(milestoneCountdown(1, false)).toEqual({
      label: 'D-1',
      tone: 'soon',
    });
    expect(milestoneCountdown(0, false)).toEqual({
      label: 'D-Day',
      tone: 'soon',
    });
  });

  it('마감 시각이 지났으면 당일이어도 마감이라고 적는다', () => {
    const closed = { label: '마감', tone: 'closed' };
    expect(milestoneCountdown(0, true)).toEqual(closed);
    expect(milestoneCountdown(-4, true)).toEqual(closed);
    expect(milestoneCountdown(-1, false)).toEqual(closed);
  });
});

describe('formatSeoulDateRange', () => {
  it('같은 해 안의 범위는 끝 날짜의 연도를 줄인다', () => {
    expect(
      formatSeoulDateRange(
        '2026-10-04T15:00:00.000Z',
        '2026-10-16T14:59:00.000Z',
      ),
    ).toBe('2026.10.05 ~ 10.16');
  });

  it('서울 기준으로 해를 넘기면 끝 날짜에도 연도를 적는다', () => {
    expect(
      formatSeoulDateRange(
        '2026-12-31T14:59:00.000Z',
        '2026-12-31T15:00:00.000Z',
      ),
    ).toBe('2026.12.31 ~ 2027.01.01');
  });

  it('끝 날짜를 적는 방식을 바꿔 끼울 수 있다', () => {
    expect(
      formatSeoulDateRange(
        '2026-10-04T15:00:00.000Z',
        '9999-12-31T23:59:59.999Z',
        () => '미정',
      ),
    ).toBe('2026.10.05 ~ 미정');
  });
});

describe('programDetailContext', () => {
  it('주관기관 뒤에 유형을 덧붙인다', () => {
    expect(
      programDetailContext({
        organizers: ['운영기관'],
        trackType: 'EXTRACURRICULAR',
      }),
    ).toBe('운영기관 · 비교과');
  });

  it('유형이 없는 프로그램은 주관기관만 적는다', () => {
    expect(
      programDetailContext({ organizers: ['운영기관'], trackType: null }),
    ).toBe('운영기관');
  });

  it('주관기관이 여러 곳이면 쉼표로 이어 붙인 뒤 유형을 덧붙인다', () => {
    expect(
      programDetailContext({
        organizers: ['전남대학교 SW중심대학사업단', 'OSS Hub 운영팀'],
        trackType: 'CURRICULAR',
      }),
    ).toBe('전남대학교 SW중심대학사업단, OSS Hub 운영팀 · 교과');
  });
});
