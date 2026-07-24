import { expect, test } from 'vitest';
import { parseRankingPage, RankingResponseError } from './api';
import { RANKING_NOTICE, RANKING_PERIODS } from './types';

test('공개 랭킹 응답만 화면 계약으로 변환한다', () => {
  expect(
    parseRankingPage({
      notice: RANKING_NOTICE,
      period: RANKING_PERIODS.THIS_YEAR,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          commitCount: 2,
          prCount: 1,
          starCount: 0,
          total: 3,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    }),
  ).toMatchObject({ period: RANKING_PERIODS.THIS_YEAR, total: 1 });
});

test('FORCE 등 예상 밖의 응답은 표시하지 않고 거부한다', () => {
  expect(() =>
    parseRankingPage({ period: RANKING_PERIODS.ALL, items: [] }),
  ).toThrow(RankingResponseError);
});
