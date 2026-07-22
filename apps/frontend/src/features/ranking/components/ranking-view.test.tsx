import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { RANKING_NOTICE, RANKING_PERIODS, type RankingItem } from '../types';
import { RankingView } from './ranking-view';

vi.mock('@/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components')>();

  return {
    ...actual,
    DataTable: ({
      data,
      rowKey,
    }: {
      readonly data: readonly RankingItem[];
      readonly rowKey: (item: RankingItem) => React.Key;
    }) => <div data-row-keys={data.map(rowKey).join(',')} />,
  };
});

const handlers = {
  onPeriodChange: () => undefined,
  onPageChange: () => undefined,
  onRetry: () => undefined,
};

test('빈 상태와 오류 재시도 상태를 사용자에게 표시한다', () => {
  const empty = renderToStaticMarkup(
    <RankingView
      period={RANKING_PERIODS.THIS_YEAR}
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          notice: RANKING_NOTICE,
          period: RANKING_PERIODS.THIS_YEAR,
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
        },
      }}
      {...handlers}
    />,
  );
  const failure = renderToStaticMarkup(
    <RankingView
      period={RANKING_PERIODS.ALL}
      page={1}
      state={{ kind: 'error' }}
      {...handlers}
    />,
  );

  expect(empty).toContain('집계된 활동 데이터가 없습니다');
  expect(failure).toContain('다시 시도');
  expect(failure).toContain(RANKING_NOTICE);
});

test('Star 집계 기준을 사용자에게 설명한다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      period={RANKING_PERIODS.THIS_YEAR}
      page={1}
      state={{ kind: 'loading' }}
      {...handlers}
    />,
  );

  expect(html).toContain(
    'Star는 해당 기간에 받은 WatchEvent.started 활동 수이며, 저장소의 현재 스타 수가 아닙니다.',
  );
});

test('GitHub 로그인이 같아도 순위가 다른 행에 고유 키를 사용한다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      period={RANKING_PERIODS.THIS_YEAR}
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          notice: RANKING_NOTICE,
          period: RANKING_PERIODS.THIS_YEAR,
          items: [
            {
              rank: 1,
              displayName: '첫 번째 참여자',
              githubLogin: 'same-login',
              commitCount: 3,
              prCount: 2,
              starCount: 1,
              total: 6,
            },
            {
              rank: 2,
              displayName: '두 번째 참여자',
              githubLogin: 'same-login',
              commitCount: 2,
              prCount: 1,
              starCount: 1,
              total: 4,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 2,
        },
      }}
      {...handlers}
    />,
  );

  expect(html).toContain('data-row-keys="1,2"');
});
