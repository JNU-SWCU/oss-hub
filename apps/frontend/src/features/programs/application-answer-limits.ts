/**
 * 학생이 직접 쓰는 신청 항목의 길이 상한.
 *
 * ⚠ 백엔드 `APPLICATION_ANSWER_MAX_LENGTHS`(`programs/application-answers.validator.ts`)와
 *   **한 벌이다.** 언어가 갈려 한 곳에서 강제할 수 없으니 한쪽을 고치면 다른 쪽도 고쳐야 한다.
 *   (저장소의 기존 관례 — 서류 검토 사유 2,000자도 같은 방식으로 양쪽에 적어 둔다.)
 *
 * ⚠ 브라우저의 `maxLength` 는 UTF-16 코드 단위로 세고 서버는 코드 포인트로 센다.
 *   한글·영문은 같지만 이모지에서는 브라우저가 **더 엄격**하다 — 안전한 방향이라 둔다
 *   (브라우저가 막은 입력은 서버에서 400 이 나지 않는다).
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
