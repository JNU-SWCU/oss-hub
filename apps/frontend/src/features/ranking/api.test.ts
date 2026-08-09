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
  dataAsOf: null,
});

test.each([RANKING_YEAR_ALL, 2025, 2026] as const)(
  'year=%s 공개 랭킹 응답을 화면 계약으로 변환한다',
  (year) => {
    expect(parseRankingPage(rankingPage(year))).toMatchObject({
      year,
      items: [{ releaseCount: 1, total: 4 }],
      total: 1,
      dataAsOf: null,
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
      dataAsOf: null,
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

// `prCount` → `pullRequestCount` 개명 전이 구간.
//
// 백엔드 개명 배포와 프런트 배포는 원자적이지 않다. 그 틈에 파서가
// 새 이름을 거부하면 랭킹 화면이 통째로 죽는다 — 그래서 파서 완화가
// 개명보다 **먼저** 나가야 한다. 아래가 그 순서를 고정한다.

const itemWith = (prKey: 'prCount' | 'pullRequestCount', prValue: number) => ({
  rank: 1,
  displayName: 'mina',
  githubLogin: 'mina',
  commitCount: 2,
  [prKey]: prValue,
  releaseCount: 1,
  total: 2 + prValue + 1,
});

const pageWith = (item: Record<string, unknown>) => ({
  year: RANKING_YEAR_ALL,
  items: [item],
  page: 1,
  pageSize: 20,
  total: 1,
  dataAsOf: null,
});

test('개명 전 이름(prCount)을 받아들인다', () => {
  const page = parseRankingPage(pageWith(itemWith('prCount', 3)));
  expect(page.items[0]?.prCount).toBe(3);
});

test('개명 후 이름(pullRequestCount)도 받아들이고 내부 표현은 prCount로 고정한다', () => {
  const page = parseRankingPage(pageWith(itemWith('pullRequestCount', 3)));
  expect(page.items[0]?.prCount).toBe(3);
  expect(page.items[0]?.total).toBe(6);
});

test('두 이름이 동시에 오면 거부한다 — 어느 쪽이 진실인지 알 수 없다', () => {
  const item = {
    ...itemWith('prCount', 3),
    pullRequestCount: 3,
  };
  expect(() => parseRankingPage(pageWith(item))).toThrow(RankingResponseError);
});

test('두 이름이 모두 없으면 거부한다 — 합계가 성립하지 않는다', () => {
  const { prCount: _omitted, ...withoutPr } = itemWith('prCount', 3);
  expect(() => parseRankingPage(pageWith(withoutPr))).toThrow(
    RankingResponseError,
  );
});

test('개명 후 이름이어도 합계가 어긋나면 거부한다', () => {
  const item = { ...itemWith('pullRequestCount', 3), total: 99 };
  expect(() => parseRankingPage(pageWith(item))).toThrow(RankingResponseError);
});

test('전이를 허용해도 닫힌 세계는 유지한다 — 허용 목록 밖 키는 계속 거부한다', () => {
  const item = { ...itemWith('pullRequestCount', 3), dataAsOf: '2026-08-09' };
  expect(() => parseRankingPage(pageWith(item))).toThrow(RankingResponseError);
});

// 갱신 시각 봉투 (ADR-010 §10).
//
// 백엔드가 이 칸을 보내기 시작하는 시점과 프런트 배포 시점은 어긋난다.
// 그 틈에 파서가 새 칸을 거부하면 랭킹 화면이 통째로 죽으므로,
// 전이 구간에는 optional 로 두고 두 배포가 끝난 뒤 required 로 올린다.

test('dataAsOf 가 없어도 파싱된다 — 백엔드 배포 전 상태', () => {
  const page = parseRankingPage(pageWith(itemWith('prCount', 3)));
  expect(page.dataAsOf).toBeNull();
});

test('dataAsOf 가 오면 Date 로 정규화한다', () => {
  const page = parseRankingPage({
    ...pageWith(itemWith('prCount', 3)),
    dataAsOf: '2026-08-09T00:00:00.000Z',
  });
  expect(page.dataAsOf?.toISOString()).toBe('2026-08-09T00:00:00.000Z');
});

test('dataAsOf 가 null 이어도 받아들인다 — 관측이 아직 없는 상태', () => {
  const page = parseRankingPage({
    ...pageWith(itemWith('prCount', 3)),
    dataAsOf: null,
  });
  expect(page.dataAsOf).toBeNull();
});

test('dataAsOf 가 날짜가 아니면 거부한다', () => {
  expect(() =>
    parseRankingPage({
      ...pageWith(itemWith('prCount', 3)),
      dataAsOf: 'not-a-date',
    }),
  ).toThrow(RankingResponseError);
});
