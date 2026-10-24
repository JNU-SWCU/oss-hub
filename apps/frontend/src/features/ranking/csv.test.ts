import { expect, test } from 'vitest';
import {
  buildRankingCsv,
  RANKING_CSV_COLUMNS,
  rankingCsvFilename,
  rfc4180Field,
} from './csv';
import { RANKING_YEAR_ALL, type StaffRankingItem } from './types';

const staffRow = (
  overrides: Partial<StaffRankingItem> = {},
): StaffRankingItem => ({
  rank: 1,
  displayName: 'synthetic-top',
  githubLogin: 'synthetic-top',
  name: 'synthetic-staff-name',
  department: '소프트웨어공학과',
  commitCount: 2,
  pullRequestCount: 1,
  issueCount: 0,
  repositoryCount: 1,
  starCount: 5,
  total: 9,
  ...overrides,
});

test('filename is ranking-YYYY.csv or ranking-all.csv', () => {
  expect(rankingCsvFilename(2026)).toBe('ranking-2026.csv');
  expect(rankingCsvFilename(RANKING_YEAR_ALL)).toBe('ranking-all.csv');
});

test('RFC 4180 quotes commas and doubled quotes', () => {
  expect(rfc4180Field('plain')).toBe('plain');
  expect(rfc4180Field('a,b')).toBe('"a,b"');
  expect(rfc4180Field('say "hi"')).toBe('"say ""hi"""');
});

test('CSV is UTF-8 BOM + RFC 4180 columns and never includes studentId or githubId', () => {
  const csv = buildRankingCsv([
    staffRow(),
    staffRow({
      rank: 2,
      githubLogin: 'synthetic-quoted',
      name: 'Name, "quoted"',
      department: null,
    }),
  ]);

  expect(csv.startsWith('\uFEFF')).toBe(true);
  const body = csv.slice(1);
  expect(body.startsWith(`${RANKING_CSV_COLUMNS.join(',')}\r\n`)).toBe(true);
  expect(body).toContain(
    '1,synthetic-staff-name,synthetic-top,소프트웨어공학과,2,1,0,1,5,9',
  );
  expect(body).toContain('2,"Name, ""quoted""",synthetic-quoted,,2,1,0,1,5,9');
  expect(csv).not.toContain('studentId');
  expect(csv).not.toContain('githubId');
});

test.each([
  ['=1+1', "'=1+1"],
  ['+cmd', "'+cmd"],
  ['-x', "'-x"],
  ['@SUM(A1)', "'@SUM(A1)"],
  ['\tx', "'\tx"],
  ['\rx', '"\'\rx"'],
  ['plain', 'plain'],
])('CSV text cell %j is exported as %j', (name, cell) => {
  expect(buildRankingCsv([staffRow({ name })])).toContain(
    `1,${cell},synthetic-top,`,
  );
});

test('CSV keeps negative numbers numeric', () => {
  expect(buildRankingCsv([staffRow({ total: -3 })])).toContain(',5,-3\r\n');
});
