import {
  RANKING_YEAR_ALL,
  type RankingYear,
  type StaffRankingItem,
} from './types';

export const RANKING_CSV_PAGE_SIZE = 100;

export const RANKING_CSV_COLUMNS = [
  'rank',
  'name',
  'githubLogin',
  'department',
  'commitCount',
  'pullRequestCount',
  'issueCount',
  'repositoryCount',
  'starCount',
  'total',
] as const;

const UTF8_BOM = '\uFEFF';

export function rankingCsvFilename(year: RankingYear): string {
  if (year === RANKING_YEAR_ALL) return 'ranking-all.csv';
  return `ranking-${year}.csv`;
}

/** RFC 4180 field — quote when the value contains comma, quote, or line breaks. */
export function rfc4180Field(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return rfc4180Field(String(value));
}

export function buildRankingCsv(items: readonly StaffRankingItem[]): string {
  const header = RANKING_CSV_COLUMNS.join(',');
  const rows = items.map((item) =>
    [
      csvCell(item.rank),
      csvCell(item.name),
      csvCell(item.githubLogin),
      csvCell(item.department),
      csvCell(item.commitCount),
      csvCell(item.pullRequestCount),
      csvCell(item.issueCount),
      csvCell(item.repositoryCount),
      csvCell(item.starCount),
      csvCell(item.total),
    ].join(','),
  );
  return `${UTF8_BOM}${[header, ...rows].join('\r\n')}\r\n`;
}

export function downloadTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
