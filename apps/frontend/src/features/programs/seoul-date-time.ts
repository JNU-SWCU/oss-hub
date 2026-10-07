const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

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
