import { describe, expect, it } from 'vitest';

import {
  clampRejectionReason,
  sanitizeDisplayText,
  REJECTION_REASON_MAX_LENGTH,
  REJECTION_REASON_MAX_LINES,
} from './display-text';

describe('clampRejectionReason', () => {
  it('사유 다듬기는 공백만 있는 값을 없는 것으로 접고 앞뒤 공백을 턴다', () => {
    expect(clampRejectionReason(null)).toBe(null);
    expect(clampRejectionReason('')).toBe(null);
    expect(clampRejectionReason('  \n\t ')).toBe(null);
    expect(clampRejectionReason('  사유  ')).toBe('사유');
    expect(clampRejectionReason('가'.repeat(REJECTION_REASON_MAX_LENGTH))).toBe(
      '가'.repeat(REJECTION_REASON_MAX_LENGTH),
    );
    expect(
      clampRejectionReason('가'.repeat(REJECTION_REASON_MAX_LENGTH + 1)),
    ).toBe(`${'가'.repeat(REJECTION_REASON_MAX_LENGTH)}…`);
  });

  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
  const FILLER = '가'.repeat(REJECTION_REASON_MAX_LENGTH);

  const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';

  it('이모지 경계에서 잘리지 않는다', () => {
    const grinning = '\u{1F600}';
    const exactlyFull = `${'가'.repeat(
      REJECTION_REASON_MAX_LENGTH - 1,
    )}${grinning}`;

    expect(exactlyFull.length).toBeGreaterThan(REJECTION_REASON_MAX_LENGTH);
    expect(clampRejectionReason(exactlyFull)).toBe(exactlyFull);

    const overflowed = clampRejectionReason(`${FILLER}${grinning}`);

    expect(overflowed).toBe(`${FILLER}\u2026`);
    expect(overflowed).not.toMatch(LONE_SURROGATE);
  });

  it('결합 이모지는 사람 셋으로 흩어지지 않는다', () => {
    const kept = clampRejectionReason(`반려 사유 ${FAMILY}`);

    expect(kept).toBe(`반려 사유 ${FAMILY}`);
    expect(kept).toContain('\u200D');

    const dropped = clampRejectionReason(`${FILLER}${FAMILY}`);

    expect(dropped).toBe(`${FILLER}\u2026`);
    expect(dropped).not.toContain('\u{1F468}');
    expect(dropped).not.toMatch(LONE_SURROGATE);
  });

  it('줄 수에도 상한이 있다', () => {
    const bomb = '\u3131\n'.repeat(200);

    const clamped = clampRejectionReason(bomb);

    expect(clamped?.split('\n')).toHaveLength(REJECTION_REASON_MAX_LINES);
    expect(clamped?.endsWith('\u2026')).toBe(true);
  });

  it('연속된 빈 줄은 하나로 접는다', () => {
    expect(clampRejectionReason('앞\n\n\n\n\n\n\n뒤')).toBe('앞\n\n뒤');
    expect(clampRejectionReason('앞\n뒤')).toBe('앞\n뒤');

    expect(clampRejectionReason('앞\r\n뒤')).toBe('앞\n뒤');
  });

  it('공백만 있는 줄도 빈 줄로 세어 접는다', () => {
    expect(clampRejectionReason('앞\n   \n   \n뒤')).toBe('앞\n\n뒤');
    expect(clampRejectionReason('앞\n \n\n \n뒤')).toBe('앞\n\n뒤');

    expect(clampRejectionReason('앞\n\t\n\t\n뒤')).toBe('앞\n\n뒤');
  });

  it.each([
    ['U+2028 줄 구분자', '\u2028'],
    ['U+2029 문단 구분자', '\u2029'],
  ] as readonly (readonly [string, string])[])(
    '%s도 줄바꿈으로 세어 상한을 지킨다',
    (_label, separator) => {
      const bomb = Array.from({ length: 200 }, () => 'ㄱ').join(separator);

      const clamped = clampRejectionReason(bomb);

      expect(clamped).not.toContain(separator);
      expect(clamped?.split('\n')).toHaveLength(REJECTION_REASON_MAX_LINES);
      expect(clamped?.endsWith('\u2026')).toBe(true);
    },
  );

  it('유니코드 줄 구분자는 지우지 않고 줄바꿈으로 살린다', () => {
    expect(clampRejectionReason('앞\u2028뒤')).toBe('앞\n뒤');
    expect(clampRejectionReason('앞\u2029뒤')).toBe('앞\n뒤');
  });

  it('제어문자와 양방향 제어문자를 지운다', () => {
    expect(clampRejectionReason('사유\u0007입니다')).toBe('사유입니다');

    expect(clampRejectionReason('\u202E사유가 뒤집힌다')).toBe(
      '사유가 뒤집힌다',
    );

    expect(clampRejectionReason('\u2066격리\u2069')).toBe('격리');
    expect(clampRejectionReason('\u200E\u200F방향 표시')).toBe('방향 표시');
    expect(clampRejectionReason('\u061C아랍 표시')).toBe('아랍 표시');

    expect(clampRejectionReason('학과\t미확인')).toBe('학과 미확인');
  });
});

describe('sanitizeDisplayText', () => {
  it('역할 요청 상한을 넘겨도 자르지 않는다', () => {
    const long = Array.from(
      { length: REJECTION_REASON_MAX_LINES + 4 },
      (_, index) => `${index + 1}번 줄`,
    ).join('\n');

    const sanitized = sanitizeDisplayText(long);

    expect(sanitized).toBe(long);
    expect(sanitized).not.toContain('…');
  });

  it('글자 수 상한을 넘겨도 자르지 않는다', () => {
    const long = '가'.repeat(REJECTION_REASON_MAX_LENGTH * 2);

    expect(sanitizeDisplayText(long)).toBe(long);
  });

  it('같은 입력을 clamp 는 자르고 sanitize 는 남긴다', () => {
    const long = Array.from(
      { length: REJECTION_REASON_MAX_LINES + 1 },
      (_, index) => `${index + 1}번 줄`,
    ).join('\n');

    expect(clampRejectionReason(long)).toContain('…');
    expect(sanitizeDisplayText(long)).not.toContain('…');
  });

  it('화면을 깨뜨리는 문자는 그대로 걷어낸다', () => {
    const attacked = '앞\u202E뒤\u0007';

    expect(sanitizeDisplayText(attacked)).toBe('앞뒤');
  });

  it('줄 구분자만으로 이루어진 값도 줄바꿈으로 모은다', () => {
    expect(sanitizeDisplayText('가\u2028나\u2029다')).toBe('가\n나\n다');
  });

  it('빈 값·공백뿐인 값은 null 이다', () => {
    expect(sanitizeDisplayText(null)).toBeNull();
    expect(sanitizeDisplayText('')).toBeNull();
    expect(sanitizeDisplayText('   \n\t  ')).toBeNull();
  });
});
