/**
 * 프로그램 종료일의 「미정」 표현 — 변환 경계 한 곳.
 *
 * 도메인에 「미정」을 담을 칸이 없어서 서버는 그 뜻을 **센티널 시각 하나**로 적는다.
 * `Program.endAt` 은 non-null 이고 DB 기본값이 이 값이며(`prisma/schema.prisma:182`),
 * 레거시 `NULL` 도 마이그레이션이 같은 값으로 채웠다
 * (`migrations/20260810120000_add_program_authoring_foundation/migration.sql:70-73`).
 *
 * 이 값이 화면까지 그대로 새 나가면 교직원은 뜻을 알 수 없는 시각을 보게 되고,
 * KST 로 옮기면 연도가 다섯 자리(`10000`)가 되어 `Invalid Date` 로 저장이 영구히
 * 실패한다(#826). 그래서 센티널 리터럴은 이 모듈에만 두고, 폼·상세·목록은 여기의
 * 판정과 라벨만 쓴다.
 */

/** 서버가 「끝나지 않음」을 적는 순간. `9999-12-31 23:59:59.999` UTC 와 같다. */
export const PROGRAM_END_AT_UNDECIDED = '9999-12-31T23:59:59.999Z';

/** 화면에 쓰는 사용자 언어. */
export const PROGRAM_END_AT_UNDECIDED_LABEL = '미정';

const UNDECIDED_TIME = new Date(PROGRAM_END_AT_UNDECIDED).getTime();

/**
 * 종료일이 「미정」인가. `null`(아직 종료일 축이 없던 응답)도 같은 뜻으로 본다.
 *
 * 문자열이 아니라 **순간**으로 대조한다 — 같은 시각을 offset 표기(`+09:00`)로 보내도
 * 뜻은 같기 때문이다. 파싱이 안 되는 값은 미정이 아니다.
 */
export function isProgramEndAtUndecided(value: string | null): boolean {
  if (value === null) return true;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time === UNDECIDED_TIME;
}

/**
 * 종료일을 화면 문구로 바꾼다. 미정이면 `미정`, 아니면 넘긴 포매터의 결과다.
 *
 * 포매터를 주입받는 이유는 화면마다 형식이 다르기 때문이다 — 상세 팩트 바는
 * `formatSeoulDateOnly`, 본문은 `formatSeoulDate` 를 쓴다(`program-detail-format.ts`).
 * 판정은 한 곳에 두고 형식만 호출자가 고른다.
 */
export function formatProgramEndAt(
  value: string | null,
  format: (iso: string) => string,
): string {
  return isProgramEndAtUndecided(value)
    ? PROGRAM_END_AT_UNDECIDED_LABEL
    : format(value as string);
}
