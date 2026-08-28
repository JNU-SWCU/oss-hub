export type ProgramScheduleEventKind =
  'APPLICATION' | 'OPERATION' | 'MILESTONE';

export type ProgramScheduleCalendarEvent = {
  readonly id: string;
  readonly label: string;
  readonly kind: ProgramScheduleEventKind;
  readonly startAt: string;
  readonly endAt: string;
};

export type ProgramScheduleWeek = {
  readonly id: string;
  readonly days: readonly string[];
};

export type ProgramScheduleWeekSegment = {
  readonly event: ProgramScheduleCalendarEvent;
  readonly startColumn: number;
  readonly span: number;
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
};

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const SEOUL_DATE_KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function dateKey(value: string): string | null {
  return DATE_KEY_PATTERN.exec(value)?.[0] ?? null;
}

export function monthKeyForEvents(
  events: readonly ProgramScheduleCalendarEvent[],
): string {
  return (
    events
      .map((event) => dateKey(event.startAt))
      .find((value) => value !== null)
      ?.slice(0, 7) ?? seoulToday().slice(0, 7)
  );
}

export function shiftMonth(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${twoDigits(shifted.getUTCMonth() + 1)}`;
}

export function shiftDate(value: string, amount: number): string {
  return addDays(value, amount);
}

export function selectedDateForMonth(
  monthKey: string,
  events: readonly ProgramScheduleCalendarEvent[],
): string {
  const monthStart = `${monthKey}-01`;
  const nextMonthStart = `${shiftMonth(monthKey, 1)}-01`;
  const firstScheduledDate = events
    .flatMap((event) => {
      const start = dateKey(event.startAt);
      const end = dateKey(event.endAt);
      if (
        start === null ||
        end === null ||
        start >= nextMonthStart ||
        end < monthStart
      )
        return [];
      return [start < monthStart ? monthStart : start];
    })
    .sort()[0];
  return firstScheduledDate ?? monthStart;
}

export function calendarWeeks(
  monthKey: string,
): readonly ProgramScheduleWeek[] {
  const [year, month] = monthKey.split('-').map(Number);
  const first = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, 1));
  const last = new Date(Date.UTC(year ?? 0, month ?? 1, 0));
  const gridStart = addDays(formatDate(first), -first.getUTCDay());
  const gridEnd = addDays(formatDate(last), 6 - last.getUTCDay());
  const days: string[] = [];
  for (
    let current = gridStart;
    current <= gridEnd;
    current = addDays(current, 1)
  )
    days.push(current);
  const weeks: ProgramScheduleWeek[] = [];
  for (let index = 0; index < days.length; index += 7) {
    const weekDays = days.slice(index, index + 7);
    weeks.push({ id: weekDays[0] ?? String(index), days: weekDays });
  }
  return weeks;
}

export function segmentsForWeek(
  week: ProgramScheduleWeek,
  events: readonly ProgramScheduleCalendarEvent[],
): readonly ProgramScheduleWeekSegment[] {
  const weekStart = week.days[0];
  const weekEnd = week.days[6];
  if (weekStart === undefined || weekEnd === undefined) return [];
  return events.flatMap((event) => {
    const start = dateKey(event.startAt);
    const end = dateKey(event.endAt);
    if (start === null || end === null || end < weekStart || start > weekEnd)
      return [];
    const clippedStart = start < weekStart ? weekStart : start;
    const clippedEnd = end > weekEnd ? weekEnd : end;
    return [
      {
        event,
        startColumn: daysBetween(weekStart, clippedStart) + 1,
        span: daysBetween(clippedStart, clippedEnd) + 1,
        continuesBefore: start < weekStart,
        continuesAfter: end > weekEnd,
      },
    ];
  });
}

export function eventsForDate(
  selectedDate: string,
  events: readonly ProgramScheduleCalendarEvent[],
): readonly ProgramScheduleCalendarEvent[] {
  return events.filter((event) => {
    const start = dateKey(event.startAt);
    const end = dateKey(event.endAt);
    return (
      start !== null &&
      end !== null &&
      start <= selectedDate &&
      selectedDate <= end
    );
  });
}

export function seoulToday(now: Date = new Date()): string {
  return SEOUL_DATE_KEY_FORMATTER.format(now);
}

export function eventBoundaryLabel(
  event: ProgramScheduleCalendarEvent,
  selectedDate: string,
): string {
  const start = dateKey(event.startAt);
  const end = dateKey(event.endAt);
  if (start === selectedDate && end === selectedDate)
    return `당일 · ${timePart(event.startAt)}–${timePart(event.endAt)}`;
  if (start === selectedDate) return `시작 · ${timePart(event.startAt)}`;
  if (end === selectedDate) return `마감 · ${timePart(event.endAt)}`;
  return '진행 중';
}

function daysBetween(start: string, end: string): number {
  return Math.round(
    (toUtc(end).getTime() - toUtc(start).getTime()) / 86_400_000,
  );
}

function addDays(value: string, amount: number): string {
  const date = toUtc(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDate(date);
}

function toUtc(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${twoDigits(date.getUTCMonth() + 1)}-${twoDigits(date.getUTCDate())}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function timePart(value: string): string {
  return value.slice(11, 16) || '시각 미정';
}
