/**
 * 「종료일 미정」 센티널 — `Program.endAt` 의 DB 기본값(`prisma/schema.prisma`)과 같은 순간이다.
 * 옛 데이터를 읽는 자리로만 남고, 만들기·편집 API 는 이 값을 새 종료일로 받지 않는다(#1420).
 * 문자열이 아니라 순간으로 비교한다 — 같은 시각을 다른 offset 으로 적어도 같은 값이기 때문이다.
 */
const PROGRAM_END_AT_UNDECIDED_TIME = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export function isProgramEndAtUndecided(value: Date): boolean {
  return value.getTime() === PROGRAM_END_AT_UNDECIDED_TIME;
}
