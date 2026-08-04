import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { RANKING_YEAR_ALL, type RankingItem } from '../types';
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
      emptyState,
      caption,
    }: {
      readonly columns: readonly {
        readonly id: string;
        readonly headClassName?: string;
        readonly cell: (item: RankingItem) => React.ReactNode;
      }[];
      readonly data: readonly RankingItem[];
      readonly rowKey: (item: RankingItem) => React.Key;
      readonly className?: string;
      readonly emptyState?: React.ReactNode;
      readonly caption?: React.ReactNode;
    }) => (
      <div
        className={className}
        data-column-widths={columns
          .map(({ id, headClassName }) => `${id}:${headClassName ?? ''}`)
          .join(',')}
        data-row-keys={data.map(rowKey).join(',')}
      >
        {caption}
        {data.length === 0 ? emptyState : null}
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
  onPageChange: () => undefined,
  onRetry: () => undefined,
};

test('모바일 레이아웃을 명시하고 기간 토글 버튼을 렌더하지 않는다', () => {
  const displayName = 'A very long participant display name';
  const githubLogin = 'participant-with-a-very-long-github-login';
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: 2026,
          items: [
            {
              rank: 1,
              displayName,
              githubLogin,
              commitCount: 3,
              prCount: 2,
              releaseCount: 1,
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

  expect(html).not.toContain('aria-label="랭킹 기간"');
  expect(html).not.toContain('aria-pressed');
  expect(html).not.toContain('>올해<');
  expect(html).not.toContain('>전체<');
  expect(html).toContain('break-keep');
  expect(html).toContain('table-fixed');
  expect(html).toContain(
    'data-column-widths="rank:w-8,member:w-24,commit:w-12 text-right,pr:w-12 text-right,release:w-12 text-right,total:w-12 text-right"',
  );
  expect(html).toContain(displayName);
  expect(html).toContain(`@${githubLogin}`);
  expect(html).not.toContain('truncate');
  expect(html).toContain('whitespace-normal');
  expect(html).toContain('break-all');
});

test('표 캡션을 렌더하지 않는다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: 2026,
          items: [
            {
              rank: 1,
              displayName: 'mina',
              githubLogin: 'mina',
              commitCount: 1,
              prCount: 0,
              releaseCount: 0,
              total: 1,
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

  expect(html).not.toContain('sr-only');
  expect(html).not.toContain('공개 GitHub 활동 랭킹');
});

test('빈 상태와 오류 재시도 상태를 사용자에게 표시한다', () => {
  const empty = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: 2025,
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
    <RankingView page={1} state={{ kind: 'error' }} {...handlers} />,
  );

  expect(empty).toContain('집계된 활동 데이터가 없습니다');
  expect(failure).toContain('다시 시도');
  expect(failure).not.toContain(
    '본 랭킹은 공개 GitHub 활동량 집계이며 평가·시상과 무관합니다.',
  );
  expect(failure).not.toContain('data-row-keys');
  expect(failure).not.toContain('표시할 데이터가 없습니다.');
});

test('집계 안내 문구를 더 이상 화면에 표시하지 않는다', () => {
  const html = renderToStaticMarkup(
    <RankingView page={1} state={{ kind: 'loading' }} {...handlers} />,
  );

  expect(html).not.toContain('집계 안내');
  expect(html).not.toContain(
    '본 랭킹은 공개 GitHub 활동량 집계이며 평가·시상과 무관합니다.',
  );
  expect(html).not.toContain(
    'Release는 해당 기간에 게시된 GitHub 릴리스 수입니다.',
  );
});

test('GitHub 로그인이 같아도 순위가 다른 행에 고유 키를 사용한다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: 2026,
          items: [
            {
              rank: 1,
              displayName: '첫 번째 참여자',
              githubLogin: 'same-login',
              commitCount: 3,
              prCount: 2,
              releaseCount: 1,
              total: 6,
            },
            {
              rank: 2,
              displayName: '두 번째 참여자',
              githubLogin: 'same-login',
              commitCount: 2,
              prCount: 1,
              releaseCount: 1,
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

// F4 QA 감사 갭: outcome-1·2·4·5는 지금까지 backend 통합 테스트
// (`public-exposure-matrix.integration.spec.ts`)에서만 증명됐다. 아래는 그 outcome들의 ranking
// 화면 절반을 고정한다 — archive 쪽 절반(outcome-2 기여자 분리, outcome-4 stale-allow,
// outcome-5 회수)은 `archive/archive.test.tsx`가 동일한 synthetic 식별자로 짝을 맞춘다.
const forbiddenRankingFields = [
  'studentId',
  'department',
  'accountStatus',
  '"role"',
  'realName',
  '@example.com',
];

test('outcome-1: 발행 전 프로젝트의 기여자는 다른 참여자가 랭킹에 있어도 함께 나타나지 않는다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: RANKING_YEAR_ALL,
          items: [
            {
              rank: 1,
              displayName: 'synthetic 활성 참여자',
              githubLogin: 'synthetic-outcome2-owner-login',
              commitCount: 5,
              prCount: 2,
              releaseCount: 1,
              total: 8,
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

  expect(html).toContain('synthetic-outcome2-owner-login');
  expect(html).not.toContain('synthetic-outcome1');
});

test('outcome-2: 발행 후 관측된 저장소의 기여자 2명이 각자의 순위와 커밋/PR/릴리스 수치로 정확히 분리되어 랭킹에 표시된다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: RANKING_YEAR_ALL,
          items: [
            {
              rank: 1,
              displayName: 'synthetic-outcome2-owner-login',
              githubLogin: 'synthetic-outcome2-owner-login',
              commitCount: 5,
              prCount: 2,
              releaseCount: 1,
              total: 8,
            },
            {
              rank: 2,
              displayName: 'synthetic-outcome2-other-login',
              githubLogin: 'synthetic-outcome2-other-login',
              commitCount: 3,
              prCount: 1,
              releaseCount: 0,
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

  expect(html).toContain('@synthetic-outcome2-owner-login');
  expect(html).toContain('@synthetic-outcome2-other-login');
  expect(html).toContain('data-row-keys="1,2"');
  for (const forbidden of forbiddenRankingFields) {
    expect(html).not.toContain(forbidden);
  }
});

test('outcome-4: 발행 이전 stale 관측 때문에 아카이브에는 여전히 노출되는 프로젝트라도, 현재 관측이 비공개면 그 기여자는 랭킹에서 제외된다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: RANKING_YEAR_ALL,
          items: [
            {
              rank: 1,
              displayName: 'synthetic 다른 활성 참여자',
              githubLogin: 'synthetic-outcome2-other-login',
              commitCount: 3,
              prCount: 1,
              releaseCount: 0,
              total: 4,
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

  expect(html).toContain('synthetic-outcome2-other-login');
  expect(html).not.toContain('synthetic-outcome4-applicant-login');
});

test('outcome-5: 발행 후 비공개로 전환(회수)된 기여자는 이전엔 랭킹에 있었더라도 최신 응답에서 빠지면 화면에서 사라진다', () => {
  const beforeRevocationHtml = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: RANKING_YEAR_ALL,
          items: [
            {
              rank: 1,
              displayName: 'synthetic 회수 예정 참여자',
              githubLogin: 'synthetic-outcome5-applicant-login',
              commitCount: 3,
              prCount: 1,
              releaseCount: 0,
              total: 4,
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
  expect(beforeRevocationHtml).toContain('synthetic-outcome5-applicant-login');

  const afterRevocationHtml = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: RANKING_YEAR_ALL,
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
        },
      }}
      {...handlers}
    />,
  );
  expect(afterRevocationHtml).not.toContain(
    'synthetic-outcome5-applicant-login',
  );
  expect(afterRevocationHtml).toContain('집계된 활동 데이터가 없습니다');
});
