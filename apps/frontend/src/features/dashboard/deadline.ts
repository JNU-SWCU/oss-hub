const seoulDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function seoulCalendarDay(value: Date): number {
  const parts = seoulDateFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);

  return Date.UTC(part('year'), part('month') - 1, part('day'));
}

export function formatDashboardDeadline(
  dueAt: string,
  now = new Date(),
): string {
  const difference = Math.round(
    (seoulCalendarDay(new Date(dueAt)) - seoulCalendarDay(now)) / 86_400_000,
  );

  if (difference === 0) return 'D-Day';
  return difference > 0 ? `D-${difference}` : `D+${Math.abs(difference)}`;
}

const seoulDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatDashboardDeadlineAbsolute(dueAt: string): string {
  const parts = seoulDateTimeFormatter.formatToParts(new Date(dueAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;

  return `${part('month')}월 ${part('day')}일 ${part('hour')}:${part('minute')} 마감`;
}
