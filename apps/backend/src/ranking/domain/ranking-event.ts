const ASIA_SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export function rankingYearInAsiaSeoul(date: Date): number {
  return new Date(date.getTime() + ASIA_SEOUL_OFFSET_MS).getUTCFullYear();
}

export function rankingYearStartInAsiaSeoul(year: number): Date {
  return new Date(Date.UTC(year, 0, 1) - ASIA_SEOUL_OFFSET_MS);
}

export function calendarDateInAsiaSeoul(date: Date): string {
  return calendarDateInUtc(new Date(date.getTime() + ASIA_SEOUL_OFFSET_MS));
}

export function calendarDateInUtc(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
