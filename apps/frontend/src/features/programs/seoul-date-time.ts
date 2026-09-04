/**
 * `datetime-local` 입력 칸의 값을 **서울 시각으로** 읽는다.
 *
 * `<input type="datetime-local">`은 표준시대(timezone)가 없는 문자열('2026-09-26T18:00')을
 * 준다. 그것을 `new Date(...)`에 그대로 넘기면 **브라우저가 설정된 시간대**로 해석한다. 이
 * 서비스의 날짜는 어디서 보든 서울 시각으로 적히고 읽히므로, 시스템 시간대가 서울이 아닌
 * 사람에게는 고른 시각과 저장된 시각이 어긋난다 — UTC로 맞춰 둔 브라우저에서 18:00을 고르면
 * 서울 기준 **다음 날 새벽 3시**가 저장되고, 화면은 그 3시를 그대로 보여 준다.
 *
 * 그래서 시대 표기가 없는 값에는 `+09:00`을 붙여 읽는다. 시대 표기가 이미 있는 값(서버가
 * 준 ISO 문자열 등)은 그대로 둔다 — 그것은 이미 어느 순간인지 정해진 값이다.
 *
 * ⚠ `new Date(value)`로 되돌리지 마라. 개발자 노트북과 CI가 대개 서울(또는 그 근처)이라
 * 테스트도 화면도 멀쩡해 보이지만, 다른 시간대의 교직원 한 사람에게만 조용히 틀린다.
 */
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** 서울 시각으로 읽은 epoch milliseconds. 비었거나 읽을 수 없으면 `null`. */
export function seoulDateTimeValue(value: string): number | null {
  if (value.trim() === '') return null;
  const localDateTime = LOCAL_DATE_TIME_PATTERN.exec(value);
  const normalized =
    localDateTime === null
      ? value
      : `${localDateTime[1]}-${localDateTime[2]}-${localDateTime[3]}T${localDateTime[4]}:${localDateTime[5]}:${localDateTime[6] ?? '00'}+09:00`;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}
