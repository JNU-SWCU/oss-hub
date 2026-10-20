const TIME_PATTERN = /T(\d{2}:\d{2})/;

export type RangeDateSelectionPlan = {
  readonly anchorDate: string | null;
  readonly startAt: string;
  readonly endAt: string;
};

export function planRangeDateSelection(input: {
  readonly anchorDate: string | null;
  readonly clickedDate: string;
  readonly currentStartAt: string;
  readonly currentEndAt: string;
}): RangeDateSelectionPlan {
  const startTime = timePart(input.currentStartAt, '00:00');
  const endTime = timePart(input.currentEndAt, '23:59');
  if (input.anchorDate === null) {
    return {
      anchorDate: input.clickedDate,
      startAt: `${input.clickedDate}T${startTime}`,
      endAt: `${input.clickedDate}T${endTime}`,
    };
  }
  const [startDate, endDate] = [input.anchorDate, input.clickedDate].sort();
  return {
    anchorDate: null,
    startAt: `${startDate}T${startTime}`,
    endAt: `${endDate}T${endTime}`,
  };
}

export function dateTimeForDate(
  date: string,
  currentValue: string,
  fallbackTime: string,
): string {
  return `${date}T${timePart(currentValue, fallbackTime)}`;
}

export function timePart(value: string, fallback = ''): string {
  return TIME_PATTERN.exec(value)?.[1] ?? fallback;
}

export function dateWithinBounds(
  date: string,
  minDate?: string,
  maxDate?: string,
): boolean {
  return (
    (minDate === undefined || date >= minDate) &&
    (maxDate === undefined || date <= maxDate)
  );
}

export function formatKoreanDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    return date;
  const weekday = new Intl.DateTimeFormat('ko-KR', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return `${year}년 ${month}월 ${day}일 (${weekday})`;
}
