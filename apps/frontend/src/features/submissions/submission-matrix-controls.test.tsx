import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MatrixQuickFilterButtons } from './components/submission-matrix-controls';
import { parseSubmissionMatrixSearchParams } from './submission-matrix-url-state';
import type { MatrixCell, MatrixMilestone, MatrixRow } from './types';

const NOW = new Date('2026-09-15T12:00:00+09:00');
const milestones: MatrixMilestone[] = [
  { id: 'm1', name: '기획서', dueAt: '2026-09-10T23:59:59+09:00' },
];

function rowWith(
  teamId: string,
  cell: Pick<MatrixCell, 'status' | 'deliveryStatus'>,
): MatrixRow {
  return {
    teamId,
    applicationMode: 'TEAM',
    displayName: teamId,
    githubLogins: [],
    cells: [
      {
        milestoneId: 'm1',
        submissionId: null,
        revision: null,
        submittedAt: null,
        reviewUrl: null,
        changesRequestedCount: 0,
        ...cell,
      },
    ],
  };
}

const rows = [
  rowWith('a', { status: 'NOT_SUBMITTED', deliveryStatus: 'MISSING' }),
  rowWith('b', { status: 'SUBMITTED', deliveryStatus: 'COMPLETE' }),
  rowWith('c', { status: 'SUBMITTED', deliveryStatus: 'LATE' }),
];

function chipLabels(html: string): readonly string[] {
  const container = document.createElement('div');
  container.innerHTML = html;
  return [...container.querySelectorAll('button')].map(
    (button) => `${button.textContent}:${button.getAttribute('aria-pressed')}`,
  );
}

it('각 필터 그룹의 접근성 이름이 자기 화면 제목을 참조한다', () => {
  const container = document.createElement('div');

  container.innerHTML = renderToStaticMarkup(
    <>
      {[0, 1].map((key) => (
        <MatrixQuickFilterButtons
          key={key}
          rows={[]}
          visibleMilestones={[]}
          now={NOW}
          quickFilter="ALL"
          onQuickFilterChange={vi.fn()}
        />
      ))}
    </>,
  );

  const groups = [...container.querySelectorAll('[role="group"]')];
  expect(groups).toHaveLength(2);
  const titleIds = groups.map((group) => {
    const title = group.querySelector('p');
    expect(title?.id).toBeTruthy();
    expect(title?.textContent).toBe('상태');
    expect(group.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(group.hasAttribute('aria-label')).toBe(false);
    return title?.id;
  });
  expect(new Set(titleIds).size).toBe(groups.length);
});

it('0건인 상태 칩은 숨기고, 눌린 칩은 0건이어도 남긴다', () => {
  const render = (quickFilter: 'ALL' | 'REJECTED') =>
    chipLabels(
      renderToStaticMarkup(
        <MatrixQuickFilterButtons
          rows={rows}
          visibleMilestones={milestones}
          now={NOW}
          quickFilter={quickFilter}
          onQuickFilterChange={vi.fn()}
        />,
      ),
    );

  expect(render('ALL')).toEqual([
    '전체 3:true',
    '기한 지남 1:false',
    '검토 대기 2:false',
  ]);
  expect(render('REJECTED')).toEqual([
    '전체 3:false',
    '기한 지남 1:false',
    '검토 대기 2:false',
    '반려 0:true',
  ]);
});

it.each(['MISSING', 'LATE', 'COMPLETE', 'NO_REQUIRED_ITEMS'])(
  '옛 quickFilter=%s 주소는 전체 칩이 눌린 상태로 연다',
  (legacy) => {
    const { quickFilter } = parseSubmissionMatrixSearchParams(
      new URLSearchParams(`quickFilter=${legacy}`),
    );
    const labels = chipLabels(
      renderToStaticMarkup(
        <MatrixQuickFilterButtons
          rows={rows}
          visibleMilestones={milestones}
          now={NOW}
          quickFilter={quickFilter}
          onQuickFilterChange={vi.fn()}
        />,
      ),
    );
    expect(labels.filter((label) => label.endsWith(':true'))).toEqual([
      '전체 3:true',
    ]);
  },
);
