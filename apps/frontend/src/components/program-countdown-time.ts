const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

const SEOUL_CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

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

const pad2 = (value: number): string => String(value).padStart(2, '0');

export function formatClock(date: Date): string {
  return SEOUL_CLOCK_FORMAT.format(date).replace(/^24:/, '00:');
}

export function formatCountdownDate(date: Date): string {
  const [year, month, day] = SEOUL_DATE_FORMAT.format(date)
    .split('-')
    .map(Number);
  const weekday =
    WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}.${pad2(month)}.${pad2(day)} (${weekday})`;
}

const formatHourMinute = (date: Date): string =>
  SEOUL_HOUR_MINUTE_FORMAT.format(date).replace(/^24:/, '00:');

export const formatCountdownDateTime = (date: Date): string =>
  `${formatCountdownDate(date)} ${formatHourMinute(date)}`;

export const formatCountdownListDate = (date: Date): string =>
  `${formatCountdownDate(date).slice(0, 10)} ${formatHourMinute(date)}`;

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
