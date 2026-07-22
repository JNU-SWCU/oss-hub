import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { RANKING_NOTICE, RANKING_PERIODS, type RankingItem } from '../types';
import { RankingView } from './ranking-view';

vi.mock('@/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components')>();

  return {
    ...actual,
    DataTable: ({
      columns,
      data,
      rowKey,
      className,
    }: {
      readonly columns: readonly {
        readonly id: string;
        readonly headClassName?: string;
        readonly cell: (item: RankingItem) => React.ReactNode;
      }[];
      readonly data: readonly RankingItem[];
      readonly rowKey: (item: RankingItem) => React.Key;
      readonly className?: string;
    }) => (
      <div
        className={className}
        data-column-widths={columns
          .map(({ id, headClassName }) => `${id}:${headClassName ?? ''}`)
          .join(',')}
        data-row-keys={data.map(rowKey).join(',')}
      >
        {data.map((item) => (
          <div key={rowKey(item)}>
            {columns.map((column) => (
              <div key={column.id} data-column-id={column.id}>
                {column.cell(item)}
              </div>
            ))}
          </div>
        ))}
      </div>
    ),
  };
});

const handlers = {
  onPeriodChange: () => undefined,
  onPageChange: () => undefined,
  onRetry: () => undefined,
};

test('선택한 집계 기간과 모바일 레이아웃을 명시한다', () => {
  const displayName = 'A very long participant display name';
  const githubLogin = 'participant-with-a-very-long-github-login';
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
              displayName,
              githubLogin,
              commitCount: 3,
              prCount: 2,
              starCount: 1,
              total: 6,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        },
      }}
      {...handlers}
    />,
  );

  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('break-keep');
  expect(html).toContain('table-fixed');
  expect(html).toContain(
    'data-column-widths="rank:w-8,member:w-24,commit:w-12 text-right,pr:w-12 text-right,star:w-12 text-right,total:w-12 text-right"',
  );
  expect(html).toContain(displayName);
  expect(html).toContain(`@${githubLogin}`);
  expect(html).not.toContain('truncate');
  expect(html).toContain('whitespace-normal');
  expect(html).toContain('break-all');
});

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
