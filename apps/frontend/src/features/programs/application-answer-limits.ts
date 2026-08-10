/**
 * 학생이 직접 쓰는 신청 항목의 길이 상한.
 *
 * ⚠ 백엔드 `APPLICATION_ANSWER_MAX_LENGTHS`(`programs/application-answers.validator.ts`)와
 *   **한 벌이다.** 언어가 갈려 한 곳에서 강제할 수 없으니 한쪽을 고치면 다른 쪽도 고쳐야 한다.
 *   (저장소의 기존 관례 — 서류 검토 사유 2,000자도 같은 방식으로 양쪽에 적어 둔다.)
 *
 * ⚠ 양쪽 다 **UTF-16 코드 단위**로 센다(브라우저의 `maxLength`, 서버의 `String.length`).
 *   게다가 브라우저는 공백을 덜어 내기 **전** 값을 세고 서버는 덜어 낸 뒤를 센다 —
 *   그래서 브라우저가 서버보다 느슨해질 수 없다. 이 방향이 중요하다: 반대가 되면
 *   학생이 다 쓰고 제출하는 순간에야 400 을 만난다.
 *   ⚠ 그러니 `maxLength` 를 코드 포인트 세기(`[...value].length`)로 "맞추지" 말 것 —
 *     그 순간 브라우저가 서버보다 느슨해진다.
 */
export const APPLICATION_ANSWER_MAX_LENGTHS = {
  title: 200,
  summary: 10_000,
} as const;

export type ApplicationAnswerKey = keyof typeof APPLICATION_ANSWER_MAX_LENGTHS;

export function applicationAnswerMaxLength(key: string): number | undefined {
  return key in APPLICATION_ANSWER_MAX_LENGTHS
    ? APPLICATION_ANSWER_MAX_LENGTHS[key as ApplicationAnswerKey]
    : undefined;
}
