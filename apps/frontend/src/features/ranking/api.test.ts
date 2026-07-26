import { expect, test } from 'vitest';
import { parseRankingPage, RankingResponseError } from './api';
import { RANKING_NOTICE, RANKING_PERIODS } from './types';

const rankingPage = (
  period: (typeof RANKING_PERIODS)[keyof typeof RANKING_PERIODS],
) => ({
  notice: RANKING_NOTICE,
  period,
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

test.each([RANKING_PERIODS.THIS_YEAR, RANKING_PERIODS.ALL])(
  '%s 공개 랭킹 응답을 화면 계약으로 변환한다',
  (period) => {
    expect(parseRankingPage(rankingPage(period))).toMatchObject({
      period,
      items: [{ releaseCount: 1, total: 4 }],
      total: 1,
    });
  },
);

test('활동별 합계와 total이 일치하지 않으면 거부한다', () => {
  const value = rankingPage(RANKING_PERIODS.THIS_YEAR);
  value.items[0].total = 3;

  expect(() => parseRankingPage(value)).toThrow(RankingResponseError);
});

test('legacy star 응답과 정확한 DTO 형태가 아닌 응답을 거부한다', () => {
  const { releaseCount: _, ...legacyItem } = rankingPage(RANKING_PERIODS.ALL)
    .items[0];

  expect(() =>
    parseRankingPage({
      ...rankingPage(RANKING_PERIODS.ALL),
      items: [{ ...legacyItem, starCount: 1 }],
    }),
  ).toThrow(RankingResponseError);
  expect(() =>
    parseRankingPage({
      ...rankingPage(RANKING_PERIODS.ALL),
      unexpected: true,
    }),
  ).toThrow(RankingResponseError);
});

test('FORCE 등 필수 필드가 없는 응답은 표시하지 않고 거부한다', () => {
  expect(() =>
    parseRankingPage({ period: RANKING_PERIODS.ALL, items: [] }),
  ).toThrow(RankingResponseError);
});
