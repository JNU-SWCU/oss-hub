const SEOUL_TIME_ZONE = 'Asia/Seoul';

const DUE_DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SEOUL_TIME_ZONE,
  month: 'long',
  day: 'numeric',
});

const DUE_DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SEOUL_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const SUBMITTED_AT_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SEOUL_TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 열 머리글용 마감일 — Asia/Seoul 달력 기준 "M월 D일". */
export function formatMatrixDueDate(dueAt: string): string {
  return DUE_DATE_FORMAT.format(new Date(dueAt));
}

/** 집중 보기용 마감 시각 — 날짜·요일·오전/오후를 모두 드러낸다. */
export function formatMatrixDueDateTime(dueAt: string): string {
  const parts = DUE_DATE_TIME_FORMAT.formatToParts(new Date(dueAt));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}년 ${get('month')}월 ${get('day')}일 (${get('weekday')}) ${get('dayPeriod')} ${get('hour')}:${get('minute')}`;
}

function seoulCalendarDayNumber(value: Date): number {
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

export interface NotSubmittedDeadline {
  readonly overdue: boolean;
  readonly label: string;
}

/** 미제출 칸에 표시할 마감 초과 또는 D-day 안내를 만든다. */
export function notSubmittedDeadline(
  dueAt: string,
  now: Date,
): NotSubmittedDeadline {
  const due = new Date(dueAt);
  const dDay = seoulCalendarDayNumber(due) - seoulCalendarDayNumber(now);
  if (now.getTime() > due.getTime()) {
    return {
      overdue: true,
      label: dDay < 0 ? `마감 초과 D+${-dDay}` : '마감 초과',
    };
  }
  return { overdue: false, label: dDay === 0 ? '오늘 마감' : `D-${dDay}` };
}

/** 제출 시각 — 표 안에서 짧게 읽히는 "MM.DD HH:MM" 형식. */
export function formatSubmittedAt(submittedAt: string): string {
  const parts = SUBMITTED_AT_FORMAT.formatToParts(new Date(submittedAt));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}
