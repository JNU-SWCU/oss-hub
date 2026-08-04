import { expect, test } from 'vitest';
import {
  parseRankingPage,
  parseRankingYears,
  RankingResponseError,
} from './api';
import {
  RANKING_YEAR_ALL,
  parseRankingYearSearchParam,
  rankingListHref,
} from './types';

const rankingPage = (year: number | typeof RANKING_YEAR_ALL) => ({
  year,
  items: [
    {
      rank: 1,
      displayName: 'mina',
      githubLogin: 'mina',
      commitCount: 2,
      prCount: 1,
      releaseCount: 1,
      total: 4,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
});

test.each([RANKING_YEAR_ALL, 2025, 2026] as const)(
  'year=%s 공개 랭킹 응답을 화면 계약으로 변환한다',
  (year) => {
    expect(parseRankingPage(rankingPage(year))).toMatchObject({
      year,
      items: [{ releaseCount: 1, total: 4 }],
      total: 1,
    });
  },
);

test('활동별 합계와 total이 일치하지 않으면 거부한다', () => {
  const value = rankingPage(2026);
  value.items[0].total = 3;

  expect(() => parseRankingPage(value)).toThrow(RankingResponseError);
});

test('legacy star 응답과 정확한 DTO 형태가 아닌 응답을 거부한다', () => {
  const { releaseCount: _, ...legacyItem } =
    rankingPage(RANKING_YEAR_ALL).items[0];

  expect(() =>
    parseRankingPage({
      ...rankingPage(RANKING_YEAR_ALL),
      items: [{ ...legacyItem, starCount: 1 }],
    }),
  ).toThrow(RankingResponseError);
  expect(() =>
    parseRankingPage({
      ...rankingPage(RANKING_YEAR_ALL),
      unexpected: true,
    }),
  ).toThrow(RankingResponseError);
});

test('필수 필드가 없는 응답은 표시하지 않고 거부한다', () => {
  expect(() => parseRankingPage({ year: RANKING_YEAR_ALL, items: [] })).toThrow(
    RankingResponseError,
  );
});

test('notice 필드를 포함한 구식 응답은 계약 밖 필드로 간주해 거부한다', () => {
  expect(() =>
    parseRankingPage({
      ...rankingPage(RANKING_YEAR_ALL),
      notice: '본 랭킹은 공개 GitHub 활동량 집계이며 평가·시상과 무관합니다.',
    }),
  ).toThrow(RankingResponseError);
});

test('period 필드를 포함한 구식 응답은 거부한다', () => {
  expect(() =>
    parseRankingPage({
      period: 'THIS_YEAR',
      items: rankingPage(2026).items,
      page: 1,
      pageSize: 20,
      total: 1,
    }),
  ).toThrow(RankingResponseError);
});

test('연도 목록 응답을 파싱한다', () => {
  expect(parseRankingYears({ years: [2026, 2025] })).toEqual({
    years: [2026, 2025],
  });
  expect(() => parseRankingYears({ years: ['2026'] })).toThrow(
    RankingResponseError,
  );
  expect(() => parseRankingYears({ years: [2026], extra: true })).toThrow(
    RankingResponseError,
  );
});

test('URL year 파싱과 href 생성', () => {
  expect(parseRankingYearSearchParam(null)).toBe(RANKING_YEAR_ALL);
  expect(parseRankingYearSearchParam('all')).toBe(RANKING_YEAR_ALL);
  expect(parseRankingYearSearchParam('2025')).toBe(2025);
  expect(parseRankingYearSearchParam('nope')).toBe(RANKING_YEAR_ALL);
  expect(rankingListHref(RANKING_YEAR_ALL)).toBe('/ranking');
  expect(rankingListHref(2025)).toBe('/ranking?year=2025');
});
