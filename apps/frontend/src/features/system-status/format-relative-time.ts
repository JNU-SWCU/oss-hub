const RELATIVE_TIME_UNITS: readonly (readonly [
  Intl.RelativeTimeFormatUnit,
  number,
])[] = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat('ko', {
  numeric: 'auto',
});

export function formatRelativeTime(value: string, now: Date): string {
  const diffSeconds = Math.round(
    (new Date(value).getTime() - now.getTime()) / 1000,
  );
  if (Math.abs(diffSeconds) < 60) return '방금 전';
  for (const [unit, secondsInUnit] of RELATIVE_TIME_UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return relativeTimeFormatter.format(
        Math.round(diffSeconds / secondsInUnit),
        unit,
      );
    }
  }
  return relativeTimeFormatter.format(Math.round(diffSeconds / 60), 'minute');
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatLastSuccess(value: string | null | undefined): string {
  if (value == null) return '아직 성공한 수집 없음';
  return `${formatRelativeTime(value, new Date())} (${DATE_TIME_FORMAT.format(new Date(value))})`;
}
