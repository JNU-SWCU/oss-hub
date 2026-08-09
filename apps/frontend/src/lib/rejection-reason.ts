/**
 * 관리자·교직원이 자유롭게 쓴 **반려 사유**를 화면에 싣기 전에 다듬는다.
 *
 * 두 화면이 같은 규칙을 쓴다 — 교직원 역할 요청 반려
 * (`features/roles/components/role-selection-screen.tsx`)와 프로그램 신청 반려
 * (`features/programs/program-apply-views.tsx`). `features/*`끼리는 서로 import할 수
 * 없으므로(`docs/rules/frontend.md`의 의존 방향, `eslint.config.mjs`가 강제) 공유가
 * 필요해진 시점에 이 계층으로 내렸다. 알고리즘은 옮기면서 한 줄도 바꾸지 않았다.
 */

/**
 * 화면에 실을 사유의 최대 길이 — **문자소(grapheme) 기준**이다.
 *
 * 사유에는 **길이 제한이 어디에도 없다** — 관리자 대화상자의 textarea에 `maxLength`가
 * 없고(`admin-access-mutation-reject-dialog.tsx`), DTO는 `@IsString()`뿐이며
 * (`patch-admin-access.dto.ts`) 저장은 `String?`이다. 그러니 표시 쪽이 자른다.
 * XSS는 React가 자동으로 이스케이프하므로 위험이 아니다(저장소 전체
 * `dangerouslySetInnerHTML` 0건) — 실제 위험은 레이아웃 파괴다.
 *
 * **내용 길이 기준이다** — 잘렸음을 알리는 말줄임표는 이 수에 들어가지 않는다. 그래서
 * 잘린 문자열의 실제 문자소 수는 301이 된다. 화면 폭 계산에 쓸 때 그 한 글자를 함께 세라.
 *
 * ⚠ **300이라는 숫자 자체에는 근거가 없다.** 넘치는 것보다 낫다는 것 말고는 잰 것이
 * 없다. 관리자가 실제로 쓰는 사유 길이를 아는 사람이 조정하라 — 늘릴 때는
 * `role-selection-screen.tsx`의 `ClosedRoleRequestAlert` 주석에 있는 실측을 함께 다시
 * 재야 한다.
 */
export const REJECTION_REASON_MAX_LENGTH = 300;

/**
 * 화면에 실을 사유의 최대 줄 수.
 *
 * 글자 수만 재면 **세로 높이에는 상한이 없다.** `whitespace-pre-wrap`이 관리자가 넣은
 * 줄바꿈을 그대로 살리므로, 300자 안이어도 줄바꿈만 300개면 화면이 무너진다 — 글자
 * 수로는 통과하는 값이 레이아웃을 깨는 셈이다. 줄도 함께 잰다.
 *
 * 6줄인 이유: 375px에서 한 줄이 약 20px이라 6줄이면 사유 블록이 약 120px이고, 지금
 * 실측한 사유 블록(101.5px, `role-selection-screen.tsx`의 `ClosedRoleRequestAlert`
 * 주석의 표)에서 한 줄 남짓만 더 늘어나는 선이다.
 */
export const REJECTION_REASON_MAX_LINES = 6;

/**
 * 화면에 실을 수 없는 문자.
 *
 * 관리자는 사유를 **붙여넣기로** 들여올 수 있고, 그때 눈에 보이지 않는 것들이 함께
 * 따라온다. 두 부류를 지운다.
 *
 * 1. **제어문자** — C0(`U+0000`~`U+001F`)와 C1(`U+007F`~`U+009F`). 단 줄바꿈
 *    (`U+000A`)은 살린다 — 관리자가 의도한 문단 구분이다. 탭(`U+0009`)은 지우지 않고
 *    공백으로 바꾼다(아래 `clampRejectionReason`) — 지우면 단어가 서로 붙는다.
 * 2. **양방향(Bidi) 제어문자** — `U+200E`·`U+200F`(방향 표시), `U+202A`~`U+202E`
 *    (삽입·덮어쓰기), `U+2066`~`U+2069`(격리), `U+061C`(아랍 문자 표시). 이것들은
 *    **뒤에 오는 글자의 표시 순서를 뒤집는다.** 사유 한 줄이 화면에서 거꾸로 읽히면
 *    사용자는 관리자가 쓰지 않은 문장을 읽게 된다.
 *
 * ⚠ `U+200C`(ZWNJ)·`U+200D`(ZWJ)는 **지우지 않는다.** ZWJ는 가족 이모지처럼 여러 코드
 * 포인트를 한 글자로 묶는 접착제라, 지우면 가족 이모지가 사람 셋으로 흩어진다. 그래서
 * 범위를 `U+200B`~`U+200F` 통째로 잡지 않고 Bidi 표시 둘만 집어 낸다.
 */
const UNRENDERABLE_PATTERN =
  // 범위를 이스케이프로만 쓴다 — 소스에 제어문자를 그대로 박으면 이 파일 자체가
  // 편집기에서 깨져 보이고, Bidi 문자는 주변 코드까지 거꾸로 읽히게 만든다.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * 줄바꿈으로 세어야 하는 유니코드 구분자.
 *
 * `U+2028`(줄 구분자)·`U+2029`(문단 구분자)는 **화면에서는 줄을 바꾸는데
 * `split('\n')`에는 잡히지 않는다.** 지우지도 않고 그냥 두면 줄 수 상한을 통째로
 * 우회한다 — 이 둘로만 이루어진 사유는 몇 줄이든 "한 줄"로 세어져 상한 6을 지나간다.
 * 그래서 제거가 아니라 **평범한 줄바꿈으로 정규화**한다. 관리자가 의도한 줄 나눔은
 * 살리면서 세는 규칙 하나로 모으는 쪽이 맞다.
 */
const UNICODE_LINE_SEPARATOR_PATTERN = /[\u2028\u2029]/g;

/**
 * 빈 줄을 하나까지만 남긴다.
 *
 * 정규식(`/\n{3,}/`)으로 세던 때는 **공백만 있는 줄을 빈 줄로 세지 못했다.**
 * 붙여넣기로 들어온 사유는 `\n \n \n`처럼 줄마다 공백이 남는 일이 흔한데, 그런
 * 값은 눈에는 빈 줄인데 규칙에는 내용 있는 줄로 잡혀 접히지 않았다. 줄 단위로
 * 다듬으면 두 경우가 같은 규칙을 탄다.
 */
function collapseBlankLines(value: string): string {
  const collapsed: string[] = [];
  for (const line of value.split('\n')) {
    // 공백뿐인 줄은 빈 줄이다 — 눈에 보이는 것과 세는 것을 같게 맞춘다.
    const normalized = line.trim() === '' ? '' : line;
    if (normalized === '' && collapsed.at(-1) === '') {
      continue;
    }
    collapsed.push(normalized);
  }
  return collapsed.join('\n');
}

/**
 * 사람이 한 글자로 보는 단위로 쪼갠다.
 *
 * `slice`로 자르면 **UTF-16 코드 유닛** 기준이라 이모지 한가운데가 잘린다. 웃는 얼굴
 * 이모지 앞에 `가`를 299개 붙인 값(UTF-16 길이 301)을 300에서 자르면 마지막에 짝 잃은
 * 상위 서로게이트만 남아 화면에 깨진 문자로 뜬다. 결합 문자·ZWJ 이모지(가족 이모지)도
 * 같은 방식으로 깨진다.
 *
 * `Intl.Segmenter`가 있으면 그것을 쓴다 — 코드 포인트가 아니라 **문자소**를 알아서,
 * ZWJ로 묶인 가족 이모지나 한글 조합 문자도 한 덩어리로 센다. 없으면 `Array.from`으로
 * 내려간다: 문자소까지는 못 가도 코드 포인트 단위라 **서로게이트가 갈라지는 일은
 * 막는다.** 이 앱의 지원 브라우저는 모두 `Segmenter`를 가지므로 폴백은 안전망일 뿐이다.
 */
const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('ko', { granularity: 'grapheme' })
    : null;

function splitGraphemes(value: string): readonly string[] {
  if (graphemeSegmenter === null) {
    return Array.from(value);
  }
  return [...graphemeSegmenter.segment(value)].map((entry) => entry.segment);
}

/**
 * 표시할 사유를 만든다. 보여 줄 것이 없으면 `null`이라, 화면은 빈 상자를 그리지 않는다.
 *
 * 공백만 있는 사유도 없는 것으로 본다 — 상자만 뜨고 안이 비면 사용자는 사유가 아직
 * 안 온 줄 알고 기다린다. 반려 **사실**과 다시 신청하라는 안내는 사유가 없어도 남는다.
 *
 * 순서가 규칙이다. 지우기(제어·Bidi) → 탭·줄바꿈 정규화(`\r\n`·`U+2028`·`U+2029`를
 * 모두 `\n`으로) → 빈 줄 접기 → 양끝 다듬기 → 줄 수 자르기 → 글자 수 자르기.
 * 지우기를 먼저 하지 않으면 지워질 문자가 글자 수에 잡혀 멀쩡한 문장이 대신 잘리고,
 * 줄바꿈을 먼저 한 종류로 모으지 않으면 `U+2028`만으로 이루어진 값이 "한 줄"로 세어져
 * 줄 수 상한을 그냥 지나간다. 줄을 먼저 자르지 않으면 글자 수로는 통과한 값이 세로로
 * 무너뜨린다.
 */
export function clampRejectionReason(reason: string | null): string | null {
  const cleaned = collapseBlankLines(
    (reason ?? '')
      .replace(UNRENDERABLE_PATTERN, '')
      .replace(/\t/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(UNICODE_LINE_SEPARATOR_PATTERN, '\n'),
  ).trim();
  if (cleaned.length === 0) {
    return null;
  }

  const lines = cleaned.split('\n');
  const lineClamped =
    lines.length > REJECTION_REASON_MAX_LINES
      ? `${lines.slice(0, REJECTION_REASON_MAX_LINES).join('\n')}…`
      : cleaned;

  const graphemes = splitGraphemes(lineClamped);
  return graphemes.length > REJECTION_REASON_MAX_LENGTH
    ? `${graphemes.slice(0, REJECTION_REASON_MAX_LENGTH).join('')}…`
    : lineClamped;
}
