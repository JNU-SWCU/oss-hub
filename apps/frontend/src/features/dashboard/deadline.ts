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

export function dashboardDeadlineDays(dueAt: string, now = new Date()): number {
  return Math.round(
    (seoulCalendarDay(new Date(dueAt)) - seoulCalendarDay(now)) / 86_400_000,
  );
}

export function formatDashboardDeadline(
  dueAt: string,
  now = new Date(),
): string {
  const difference = dashboardDeadlineDays(dueAt, now);

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

function seoulDateTimePart(value: string) {
  const parts = seoulDateTimeFormatter.formatToParts(new Date(value));
  return (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
}

export function formatDashboardDeadlineAbsolute(dueAt: string): string {
  const part = seoulDateTimePart(dueAt);

  return `${part('month')}월 ${part('day')}일 ${part('hour')}:${part('minute')} 마감`;
}

export function formatDashboardDate(value: string): string {
  const part = seoulDateTimePart(value);

  return `${part('month')}월 ${part('day')}일`;
}
