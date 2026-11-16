const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

const SEOUL_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const SEOUL_HOUR_MINUTE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const SEOUL_CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const pad2 = (value: number): string => String(value).padStart(2, '0');

type SeoulDateParts = Readonly<Record<'year' | 'month' | 'day', number>>;

function seoulDateParts(date: Date): SeoulDateParts {
  const [year, month, day] = SEOUL_DATE_FORMAT.format(date)
    .split('-')
    .map(Number);
  return { year, month, day };
}

export function formatCountdownDate(date: Date): string {
  const { year, month, day } = seoulDateParts(date);
  const weekday =
    WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}.${pad2(month)}.${pad2(day)} (${weekday})`;
}

const withoutMidnightOverflow = (time: string): string =>
  time.replace(/^24:/, '00:');

const formatHourMinute = (date: Date): string =>
  withoutMidnightOverflow(SEOUL_HOUR_MINUTE_FORMAT.format(date));

export const formatClockTime = (date: Date): string =>
  withoutMidnightOverflow(SEOUL_CLOCK_FORMAT.format(date));

export function formatDueDateTime(date: Date): string {
  const { month, day } = seoulDateParts(date);
  return `${month}월 ${day}일 ${formatHourMinute(date)}`;
}

export function formatScheduleDateTime(date: Date): string {
  const { month, day } = seoulDateParts(date);
  return `${pad2(month)}/${pad2(day)} ${formatHourMinute(date)}`;
}

export function formatUntilDeadline(label: string): string {
  const trimmed = label.trimEnd();
  return trimmed.endsWith('마감') ? `${trimmed}까지` : `${trimmed} 마감까지`;
}

export type RemainingTime = Readonly<
  Record<'days' | 'hours' | 'minutes' | 'seconds', number>
>;

export function remainingUntil(due: Date, now: Date): RemainingTime {
  const totalSeconds = Math.max(
    0,
    Math.floor((due.getTime() - now.getTime()) / 1000),
  );
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}
