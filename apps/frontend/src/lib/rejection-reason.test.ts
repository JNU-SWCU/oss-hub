import { describe, expect, it } from 'vitest';

import {
  clampRejectionReason,
  ROLE_REJECTION_REASON_MAX_LENGTH,
  ROLE_REJECTION_REASON_MAX_LINES,
} from './rejection-reason';

describe('clampRejectionReason', () => {
  /**
   * 자르기 규칙 자체를 값으로 못박는다. `toContain`으로 값을 단언하면 새 문구가
   * 옛 문구를 포함할 때 그대로 통과한다 — 이 저장소에서 실제로 당한 적이 있다.
   */
  it('사유 다듬기는 공백만 있는 값을 없는 것으로 접고 앞뒤 공백을 턴다', () => {
    expect(clampRejectionReason(null)).toBe(null);
    expect(clampRejectionReason('')).toBe(null);
    expect(clampRejectionReason('  \n\t ')).toBe(null);
    expect(clampRejectionReason('  사유  ')).toBe('사유');
    expect(
      clampRejectionReason('가'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH)),
    ).toBe('가'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH));
    expect(
      clampRejectionReason('가'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH + 1)),
    ).toBe(`${'가'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH)}…`);
  });

  /** 짝을 잃은 상위 서로게이트 — 화면에는 깨진 문자로 뜬다. */
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
  const FILLER = '가'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH);
  /** 가족 이모지 — 사람 셋을 ZWJ(`U+200D`)가 한 글자로 묶는다. */
  const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';

  /**
   * 이모지를 한가운데서 자르지 않는다.
   *
   * `slice(0, 300)`은 **UTF-16 코드 유닛** 기준이라 이모지의 앞 절반만 남긴다.
   * `'가'×299 + 이모지`(UTF-16 길이 301)를 그렇게 자르면 마지막이 `\uD83D` 하나뿐인
   * 짝 잃은 서로게이트가 되어 화면에 깨진 문자로 뜬다. 문자소 단위로 세면 그 값은
   * 애초에 300자라 자를 일이 없고, 넘칠 때도 이모지가 통째로 빠진다.
   */
  it('이모지 경계에서 잘리지 않는다', () => {
    // Given: 코드 유닛으로는 넘치지만 문자소로는 딱 맞는 값.
    const grinning = '\u{1F600}';
    const exactlyFull = `${'가'.repeat(
      ROLE_REJECTION_REASON_MAX_LENGTH - 1,
    )}${grinning}`;

    // When / Then: 자를 필요가 없으므로 원문 그대로다.
    expect(exactlyFull.length).toBeGreaterThan(
      ROLE_REJECTION_REASON_MAX_LENGTH,
    );
    expect(clampRejectionReason(exactlyFull)).toBe(exactlyFull);

    // Given / When: 한 글자 넘치면 이모지가 통째로 빠진다 — 반쪽만 남지 않는다.
    const overflowed = clampRejectionReason(`${FILLER}${grinning}`);

    // Then
    expect(overflowed).toBe(`${FILLER}\u2026`);
    expect(overflowed).not.toMatch(LONE_SURROGATE);
  });

  /**
   * ZWJ로 묶인 가족 이모지는 사람 셋으로 흩어지면 안 된다. 코드 포인트 단위로 자르면
   * 남자 이모지 하나만 남고, 제어문자 청소가 ZWJ까지 지우면 셋이 나란히 선다.
   */
  it('결합 이모지는 사람 셋으로 흩어지지 않는다', () => {
    // Given / When: 자를 필요가 없는 길이.
    const kept = clampRejectionReason(`반려 사유 ${FAMILY}`);

    // Then: ZWJ가 살아 있어야 한 덩어리로 그려진다.
    expect(kept).toBe(`반려 사유 ${FAMILY}`);
    expect(kept).toContain('\u200D');

    // When: 넘치면 통째로 빠진다.
    const dropped = clampRejectionReason(`${FILLER}${FAMILY}`);

    // Then: 반쪽(남자 이모지만 남은 형태)이 남지 않는다.
    expect(dropped).toBe(`${FILLER}\u2026`);
    expect(dropped).not.toContain('\u{1F468}');
    expect(dropped).not.toMatch(LONE_SURROGATE);
  });

  /**
   * 줄바꿈 폭탄 — 글자 수는 통과하는데 세로로 무너뜨리는 값이다.
   *
   * `whitespace-pre-wrap`이 줄바꿈을 그대로 살리므로 높이에 상한이 없었다.
   */
  it('줄 수에도 상한이 있다', () => {
    // Given: 300자 제한 안에 드는 짧은 값인데 줄만 200개다.
    const bomb = '\u3131\n'.repeat(200);

    // When
    const clamped = clampRejectionReason(bomb);

    // Then
    expect(clamped?.split('\n')).toHaveLength(ROLE_REJECTION_REASON_MAX_LINES);
    expect(clamped?.endsWith('\u2026')).toBe(true);
  });

  it('연속된 빈 줄은 하나로 접는다', () => {
    // Given / When / Then: 문단 구분은 살리되 여백 폭탄은 접는다.
    expect(clampRejectionReason('앞\n\n\n\n\n\n\n뒤')).toBe('앞\n\n뒤');
    expect(clampRejectionReason('앞\n뒤')).toBe('앞\n뒤');
    // 윈도우에서 붙여넣은 줄바꿈도 같은 규칙을 탄다.
    expect(clampRejectionReason('앞\r\n뒤')).toBe('앞\n뒤');
  });

  /**
   * 눈에 보이는 빈 줄과 세는 빈 줄이 같아야 한다.
   *
   * 정규식(`/\n{3,}/`)으로 세던 때는 **공백만 있는 줄을 빈 줄로 세지 못했다.**
   * 붙여넣기로 들어온 사유는 줄마다 공백이 남는 일이 흔한데, 그런 값은 눈에는 빈
   * 줄인데 규칙에는 내용 있는 줄로 잡혀 접히지 않고 그대로 높이를 먹었다.
   */
  it('공백만 있는 줄도 빈 줄로 세어 접는다', () => {
    // Given / When / Then
    expect(clampRejectionReason('앞\n   \n   \n뒤')).toBe('앞\n\n뒤');
    expect(clampRejectionReason('앞\n \n\n \n뒤')).toBe('앞\n\n뒤');
    // 탭이 공백으로 바뀐 뒤에도 같은 규칙을 탄다.
    expect(clampRejectionReason('앞\n\t\n\t\n뒤')).toBe('앞\n\n뒤');
  });

  /**
   * `U+2028`(줄 구분자)·`U+2029`(문단 구분자)는 **화면에서는 줄을 바꾸는데
   * `split('\n')`에는 잡히지 않는다.** 그대로 두면 줄 수 상한을 통째로 우회한다 —
   * 이 둘로만 이루어진 사유는 몇 줄이든 "한 줄"로 세어져 6줄 제한을 지나간다.
   */
  it.each([
    ['U+2028 줄 구분자', '\u2028'],
    ['U+2029 문단 구분자', '\u2029'],
  ] as readonly (readonly [string, string])[])(
    '%s도 줄바꿈으로 세어 상한을 지킨다',
    (_label, separator) => {
      // Given: 200줄짜리 폭탄. 평범한 줄바꿈이 하나도 없다.
      const bomb = Array.from({ length: 200 }, () => 'ㄱ').join(separator);

      // When
      const clamped = clampRejectionReason(bomb);

      // Then: 평범한 줄바꿈으로 정규화돼 같은 상한에 걸린다.
      expect(clamped).not.toContain(separator);
      expect(clamped?.split('\n')).toHaveLength(
        ROLE_REJECTION_REASON_MAX_LINES,
      );
      expect(clamped?.endsWith('\u2026')).toBe(true);
    },
  );

  it('유니코드 줄 구분자는 지우지 않고 줄바꿈으로 살린다', () => {
    // Given / When / Then: 관리자가 의도한 줄 나눔이므로 없애지 않는다.
    expect(clampRejectionReason('앞\u2028뒤')).toBe('앞\n뒤');
    expect(clampRejectionReason('앞\u2029뒤')).toBe('앞\n뒤');
  });

  /**
   * 제어문자·양방향 제어문자를 지운다.
   *
   * 관리자는 사유를 붙여넣기로 들여올 수 있다. Bidi 제어문자는 **뒤에 오는 글자의 표시
   * 순서를 뒤집어**, 사용자가 관리자가 쓰지 않은 문장을 읽게 만든다. 소스에 그대로
   * 적으면 이 테스트 파일 자체가 거꾸로 읽히므로 전부 이스케이프로 쓴다.
   */
  it('제어문자와 양방향 제어문자를 지운다', () => {
    // Given / When / Then
    expect(clampRejectionReason('사유\u0007입니다')).toBe('사유입니다');
    // U+202E RLO — 뒤따르는 글자의 표시 순서를 뒤집는다.
    expect(clampRejectionReason('\u202E사유가 뒤집힌다')).toBe(
      '사유가 뒤집힌다',
    );
    // U+2066/U+2069 격리, U+200E/U+200F 방향 표시, U+061C 아랍 문자 표시.
    expect(clampRejectionReason('\u2066격리\u2069')).toBe('격리');
    expect(clampRejectionReason('\u200E\u200F방향 표시')).toBe('방향 표시');
    expect(clampRejectionReason('\u061C아랍 표시')).toBe('아랍 표시');
    // 탭은 지우지 않고 공백으로 바꾼다 — 지우면 단어가 서로 붙는다.
    expect(clampRejectionReason('학과\t미확인')).toBe('학과 미확인');
  });
});
