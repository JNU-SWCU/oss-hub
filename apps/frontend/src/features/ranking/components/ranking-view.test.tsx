import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { RANKING_NOTICE, RANKING_PERIODS } from '../types';
import { RankingView } from './ranking-view';

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
