export type ProgramArchiveFilter = 'all' | number;

export function archiveListHref(filter: ProgramArchiveFilter): string {
  return filter === 'all' ? '/archive' : `/archive?year=${filter}`;
}

export function parseProgramArchiveFilter(
  value: string | null,
): ProgramArchiveFilter {
  if (value === null || value === '') return 'all';
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : 'all';
}
