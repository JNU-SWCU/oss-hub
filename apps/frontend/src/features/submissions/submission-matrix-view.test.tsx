import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SubmissionMatrixView } from './components/submission-matrix-view';
import type { SubmissionMatrixViewProps } from './components/submission-matrix-view';
import type { MatrixCell, SubmissionMatrixPage } from './types';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const NOW = new Date('2026-09-15T12:00:00+09:00');

function cell(
  milestoneId: string,
  status: MatrixCell['status'],
  submissionId: string | null = null,
): MatrixCell {
  return {
    milestoneId,
    submissionId,
    revision: submissionId === null ? null : 2,
    status,
    deliveryStatus: submissionId === null ? 'MISSING' : 'COMPLETE',
    submittedAt: submissionId === null ? null : '2026-08-19T10:00:00+09:00',
    changesRequestedCount: 0,
  };
}

const matrixData: SubmissionMatrixPage = {
  milestones: [
    { id: 'proposal', name: '기획서', dueAt: '2026-09-10T23:59:59+09:00' },
    { id: 'interim', name: '중간 보고', dueAt: '2026-09-12T23:59:59+09:00' },
    { id: 'final', name: '최종 제출', dueAt: '2026-10-30T23:59:59+09:00' },
  ],
  rows: [
    {
      teamId: 'application-team',
      applicationMode: 'TEAM',
      displayName: '오픈소스팀',
      leaderName: '김팀장',
      githubLogins: ['login-a', 'login-b'],
      cells: [
        cell('proposal', 'SUBMITTED', 'submission-existing'),
        cell('interim', 'NOT_SUBMITTED'),
        cell('final', 'REJECTED', 'submission-rejected'),
      ],
    },
    {
      teamId: 'application-personal',
      applicationMode: 'PERSONAL',
      displayName: '홍길동',
      leaderName: '홍길동',
      githubLogins: ['hong'],
      cells: [
        cell('proposal', 'APPROVED', 'submission-approved'),
        cell('interim', 'CHANGES_REQUESTED', 'submission-changes-requested'),
        {
          ...cell('final', 'NOT_SUBMITTED'),
          deliveryStatus: 'NO_REQUIRED_ITEMS',
        },
      ],
    },
  ],
  statusCounts: {
    NOT_SUBMITTED: 12,
    SUBMITTED: 5,
    CHANGES_REQUESTED: 4,
    REJECTED: 2,
    APPROVED: 9,
  },
  page: 1,
  pageSize: 20,
  total: 2,
};

function view(overrides: Partial<SubmissionMatrixViewProps> = {}) {
  return (
    <SubmissionMatrixView
      programId="program-1"
      data={matrixData}
      search=""
      filterActive={false}
      sort="progress"
      direction="desc"
      isLoading={false}
      errorMessage={null}
      now={NOW}
      onSearchChange={vi.fn()}
      onSearch={vi.fn()}
      onStatusChange={vi.fn()}
      onSort={vi.fn()}
      onResetFilters={vi.fn()}
      onPageChange={vi.fn()}
      onRetry={vi.fn()}
      {...overrides}
    />
  );
}

function render(overrides: Partial<SubmissionMatrixViewProps> = {}) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(view(overrides));
  return container;
}

it('서버 행 순서대로 팀과 개인을 표시하고 팀장·제출 상태·진행도를 보여준다', () => {
  const container = render();
  const rows = [...container.querySelectorAll('tbody tr')];
  expect(
    rows.map((row) =>
      row.querySelector('th button')?.getAttribute('aria-label'),
    ),
  ).toEqual(['오픈소스팀 단계별 상세', '홍길동 단계별 상세']);
  expect(rows[0].textContent).toContain('팀장 김팀장');
  expect(rows[1].textContent).not.toContain('팀장');
  expect(container.textContent).not.toContain('@login-a');
  expect(
    [...container.querySelectorAll('thead th')].map(
      (header) => header.textContent,
    ),
  ).toEqual([
    '팀',
    '기획서9.10 (목) 마감',
    '중간 보고9.12 (토) 마감',
    '최종 제출10.30 (금) 마감',
    '진행',
  ]);
  expect(rows[0].textContent).toContain('검토 대기');
  expect(rows[0].textContent).toContain('미제출');
  expect(rows[0].textContent).toContain('반려');
  expect(rows[1].textContent).toContain('보완 요청');
  expect(
    rows[1].querySelector('[aria-label="필수 서류 없음"]')?.textContent?.trim(),
  ).toBe('—');
  expect(
    rows[1]
      .querySelector('[role="progressbar"]')
      ?.getAttribute('aria-valuetext'),
  ).toBe('2단계 중 1단계 승인');
});

it('서버 상태 건수를 표시하고 선택 상태로 서버 응답 행을 다시 필터링하지 않는다', () => {
  const container = render({ status: 'SUBMITTED' });
  expect(
    container.querySelector(
      '[aria-label="제출 상태 필터"] [aria-pressed="true"]',
    )?.textContent,
  ).toBe('검토 대기 5');
  expect(
    container.querySelector(
      'select[aria-label="제출 상태 필터"] option[value="SUBMITTED"][selected]',
    )?.textContent,
  ).toBe('검토 대기 5');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(
    container.querySelector('button[aria-label="홍길동 단계별 상세"]'),
  ).not.toBeNull();
});

it('마일스톤 열의 정렬 요청을 보내고 선택된 열만 정렬 방향을 나타낸다', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const onSort = vi.fn();
  try {
    act(() => root.render(view({ onSort })));
    const proposal = [
      ...container.querySelectorAll<HTMLButtonElement>('thead button'),
    ].find((button) => button.textContent?.startsWith('기획서'));
    expect(proposal).toBeDefined();
    expect(
      container.querySelector('th[aria-sort="descending"]')?.textContent,
    ).toBe('진행');
    act(() => proposal?.click());
    expect(onSort).toHaveBeenCalledWith('milestone:proposal');
    act(() =>
      root.render(
        view({ sort: 'milestone:proposal', direction: 'asc', onSort }),
      ),
    );
    expect(container.querySelectorAll('th[aria-sort]')).toHaveLength(1);
    expect(proposal?.closest('th')?.getAttribute('aria-sort')).toBe(
      'ascending',
    );
  } finally {
    act(() => root.unmount());
  }
});

it('팀 상세를 펼치면 제출 시각과 검토 링크가 나타나고 다시 누르면 닫힌다', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(view()));
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="오픈소스팀 단계별 상세"]',
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('tbody a')).toBeNull();
    act(() => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const details = container.querySelector(
      `tbody tr[id="${toggle?.getAttribute('aria-controls')}"]`,
    );
    expect(details?.textContent).toContain('08.19 10:00 제출 · v2');
    expect(
      [...(details?.querySelectorAll('a') ?? [])].map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual([
      '/programs/program-1/submissions/submission-existing/review',
      '/programs/program-1/submissions/submission-rejected/review',
    ]);
    act(() => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('tbody a')).toBeNull();
  } finally {
    act(() => root.unmount());
  }
});

it('모바일 카드에서 제출된 단계만 검토 경로로 연결한다', () => {
  const cards = render().querySelector('[aria-label="팀별 제출 현황"]');
  expect(
    [...(cards?.querySelectorAll('dd a') ?? [])].map((link) =>
      link.getAttribute('href'),
    ),
  ).toEqual([
    '/programs/program-1/submissions/submission-existing/review',
    '/programs/program-1/submissions/submission-rejected/review',
    '/programs/program-1/submissions/submission-approved/review',
    '/programs/program-1/submissions/submission-changes-requested/review',
  ]);
});

it('빈 서버 결과에서 상태, 검색, 미참여를 구분한다', () => {
  const data = { ...matrixData, rows: [], total: 0 };
  expect(render({ data }).textContent).toContain('참여 중인 신청이 없습니다');
  const searched = render({ data, filterActive: true, search: '없는팀' });
  expect(searched.textContent).toContain('검색 결과가 없습니다');
  expect(searched.textContent).toContain('필터 초기화');
  const filtered = render({ data, status: 'REJECTED' });
  expect(filtered.textContent).toContain('조건에 맞는 팀이 없습니다');
  expect(filtered.textContent).toContain('필터 초기화');
  expect(filtered.querySelector('table')).toBeNull();
});

it('마일스톤이 없으면 프로그램 편집으로 추가를 안내한다', () => {
  const container = render({
    data: { ...matrixData, milestones: [], rows: [], total: 0 },
  });
  expect(container.textContent).toContain('마일스톤이 없습니다');
  expect(
    container.querySelector('a[href="/programs/program-1/edit"]')?.textContent,
  ).toBe('마일스톤 추가');
  expect(container.querySelector('[aria-label="제출 상태 필터"]')).toBeNull();
});

it('서버 전체 팀 수에 따라 페이지 탐색을 제공한다', () => {
  const paged = render({ data: { ...matrixData, page: 2, total: 41 } });
  expect(
    paged.querySelector('nav[aria-label="제출 현황 페이지"]')?.textContent,
  ).toBe('이전2 / 3다음');
  expect(
    render().querySelector('nav[aria-label="제출 현황 페이지"]'),
  ).toBeNull();
});

it('로딩 중에는 표 대신 Skeleton을 표시하고 실패 시 다시 시도를 안내한다', () => {
  const loading = render({ isLoading: true, data: null });
  expect(loading.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(loading.querySelector('table')).toBeNull();
  const failed = render({
    data: null,
    errorMessage: '제출 현황을 불러오지 못했습니다.',
  });
  expect(failed.querySelector('[role="alert"]')?.textContent).toContain(
    '제출 현황을 불러오지 못했습니다.',
  );
  expect(
    [...failed.querySelectorAll('button')].some(
      (button) => button.textContent === '다시 시도',
    ),
  ).toBe(true);
});

it('검색어 또는 상태 필터가 있을 때만 검색 폼 초기화를 제공한다', () => {
  const searchForm = (overrides?: Partial<SubmissionMatrixViewProps>) =>
    render(overrides).querySelector('form');
  expect(searchForm()?.querySelector('input')?.placeholder).toContain(
    '신청자·팀명·GitHub ID',
  );
  expect(searchForm()?.textContent).not.toContain('초기화');
  expect(searchForm({ search: '홍길동' })?.textContent).toContain('초기화');
  expect(searchForm({ status: 'NOT_SUBMITTED' })?.textContent).toContain(
    '초기화',
  );
});
