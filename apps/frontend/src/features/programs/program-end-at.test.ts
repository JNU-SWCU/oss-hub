import { describe, expect, it } from 'vitest';
import {
  formatProgramEndAt,
  isProgramEndAtUndecided,
  PROGRAM_END_AT_UNDECIDED,
} from './program-end-at';

describe('프로그램 종료일 「미정」 경계', () => {
  it('센티널과 null 을 같은 뜻으로 본다', () => {
    expect(isProgramEndAtUndecided(PROGRAM_END_AT_UNDECIDED)).toBe(true);
    expect(isProgramEndAtUndecided(null)).toBe(true);
  });

  it('같은 순간을 다른 표기로 보내도 미정으로 본다', () => {
    expect(isProgramEndAtUndecided('9999-12-31T22:59:59.999-01:00')).toBe(true);
  });

  it('보통 종료일은 미정이 아니다', () => {
    expect(isProgramEndAtUndecided('2026-08-31T09:30:59.000Z')).toBe(false);
  });

  it('센티널에서 1밀리초 이른 시각은 미정이 아니다', () => {
    expect(isProgramEndAtUndecided('9999-12-31T23:59:59.998Z')).toBe(false);
  });

  it('파싱할 수 없는 값은 미정이 아니다', () => {
    expect(isProgramEndAtUndecided('10000-01-01T08:59')).toBe(false);
    expect(isProgramEndAtUndecided('')).toBe(false);
  });

  it('미정이면 포매터를 부르지 않고 「미정」을 돌려준다', () => {
    const calls: string[] = [];
    const format = (iso: string) => {
      calls.push(iso);
      return `formatted:${iso}`;
    };

    expect(formatProgramEndAt(PROGRAM_END_AT_UNDECIDED, format)).toBe('미정');
    expect(formatProgramEndAt(null, format)).toBe('미정');
    expect(calls).toEqual([]);
  });

  it('미정이 아니면 넘긴 포매터의 결과를 돌려준다', () => {
    expect(
      formatProgramEndAt('2026-08-31T09:30:59.000Z', () => '2026.08.31'),
    ).toBe('2026.08.31');
  });
});
