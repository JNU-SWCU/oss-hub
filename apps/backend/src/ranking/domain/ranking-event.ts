const ASIA_SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export function rankingYearInAsiaSeoul(date: Date): number {
  return new Date(date.getTime() + ASIA_SEOUL_OFFSET_MS).getUTCFullYear();
}

export function rankingYearStartInAsiaSeoul(year: number): Date {
  return new Date(Date.UTC(year, 0, 1) - ASIA_SEOUL_OFFSET_MS);
}
