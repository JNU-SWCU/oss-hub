const SEOUL_TIME_ZONE = 'Asia/Seoul';

function calendarDayNumber(value: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function programDeadline(
  dueAt: Date,
  now: Date,
): {
  readonly dDay: number;
  readonly label: string;
} {
  const dDay = calendarDayNumber(dueAt) - calendarDayNumber(now);
  const label = dDay < 0 ? '마감 지남' : dDay === 0 ? '오늘 마감' : `D-${dDay}`;
  return { dDay, label };
}
