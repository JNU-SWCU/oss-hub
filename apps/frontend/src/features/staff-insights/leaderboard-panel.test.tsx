import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  createListScreenRoot,
  listNavigation,
  useTestSearchParams,
} from '../../../test-support/list-screen-root';
import { STAFF_INSIGHTS_FIXTURE } from './fixtures';
import { GroupsTab } from './groups-panel';
import { PeriodSelect } from './insights-controls';
import {
  FinderTab,
  StudentsTab,
  type StaffInsightsFinderProps,
  type StaffInsightsFinderQuery,
} from './leaderboard-panel';
import { StaffInsightsScreen } from './staff-insights-screen';
import type { StaffInsightsSummary } from './types';

vi.mock('next/navigation', () => ({
  useSearchParams: useTestSearchParams,
  useRouter: () => listNavigation,
  usePathname: () => '/dashboard/insights',
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function periodLeader(rank: number, previousRank: number | null) {
  return {
    rank,
    name: `합성 학생 ${rank}`,
    githubLogin: `synthetic-${rank}`,
    studentId: `0000${String(rank).padStart(2, '0')}`,
    department: '소프트웨어공학과',
    major: '데이터사이언스',
    total: 100 - rank,
    recentTotal: 15,
    previousRank,
    collaborationRatio: 0.34,
  };
}

const ATTENTION_LOGIN = 'synthetic-attention';
const LAST_ACTIVE = new Date('2026-05-01T15:30:00.000Z');

const rankingSummary: StaffInsightsSummary = {
  ...STAFF_INSIGHTS_FIXTURE,
  scope: { kind: 'calendar', year: 2026 },
  firstContributionCount: null,
  leaders: {
    period: {
      all: [
        periodLeader(1, 1),
        periodLeader(2, 5),
        periodLeader(3, 2),
        {
          ...periodLeader(4, null),
          recentTotal: null,
          collaborationRatio: null,
        },
      ],
      swMajor: [],
      nonSw: [],
    },
    recent: {
      all: [
        { ...periodLeader(2, 5), rank: 1 },
        {
          ...periodLeader(1, 1),
          rank: 2,
          githubLogin: 'synthetic-recent-only',
        },
      ],
      swMajor: [],
      nonSw: [],
    },
  },
  attentionStudents: [
    {
      ...periodLeader(5, null),
      name: null,
      githubLogin: ATTENTION_LOGIN,
      studentId: null,
      department: null,
      lastActiveAt: LAST_ACTIVE,
    },
  ],
};

const finderQuery: StaffInsightsFinderQuery = {
  search: '',
  department: '',
  programId: '',
  minActivity: 0,
  recentActivity: 'all',
  sort: 'total',
  direction: 'desc',
  page: 2,
};

const finderResult: StaffInsightsFinderProps['result'] = {
  kind: 'ready',
  data: {
    rows: [
      {
        name: '합성 찾기 결과',
        githubLogin: 'synthetic-finder-only',
        studentId: '012345',
        major: null,
        total: 0,
        recentTotal: null,
        collaborationRatio: null,
        programIds: [STAFF_INSIGHTS_FIXTURE.programs[0].programId],
      },
    ],
    page: 2,
    pageSize: 20,
    total: 53,
  },
};

describe('staff insights panels', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function section(label: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(
      `[aria-label="${label}"]`,
    );
    if (!element) throw new Error(`Missing section: ${label}`);
    return element;
  }

  function button(label: string): HTMLButtonElement {
    const element = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (!element) throw new Error(`Missing button: ${label}`);
    return element;
  }

  async function choose(id: string, value: string): Promise<void> {
    const select = container.querySelector<HTMLSelectElement>(`#${id}`);
    if (!select) throw new Error(`Missing select: ${id}`);
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('renders period ranks with authoritative recent Top 10 membership, and distinguishes rank changes and unknown metrics', async () => {
    await act(async () =>
      root.render(<StudentsTab summary={rankingSummary} />),
    );
    const ranking = section('학생 순위 표');
    const rows = Array.from(
      ranking.querySelectorAll<HTMLTableRowElement>('tbody tr'),
    );
    expect(rows.map((row) => row.cells[0].textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(rows.map((row) => row.textContent?.includes('급상승'))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(rows.map((row) => row.cells[7].textContent)).toEqual([
      '유지',
      '상승 3',
      '하락 1',
      '신규',
    ]);
    expect(rows[0].cells[2].textContent).toBe('000001');
    expect(rows[0].cells[4].textContent).toBe('데이터사이언스');
    expect(rows[0].cells[8].textContent).toBe('34%');
    expect(rows[3].cells[6].textContent).toBe('—');
    expect(rows[3].cells[8].textContent).toBe('—');
    expect(
      ranking.querySelector('[href="https://github.com/synthetic-1"]')
        ?.textContent,
    ).toBe('합성 학생 1');
    expect(ranking.textContent).not.toContain('@synthetic-1');
    expect(ranking.textContent).not.toContain('직전 연도 순위와 비교합니다');
    expect(container.textContent).not.toContain('synthetic-recent-only');
    expect(section('학생 지표').textContent).toContain('이번 달 첫 기여 학생—');

    const attention = section('관심 필요 학생 표');
    expect(attention.querySelector('a')?.textContent).toBe(ATTENTION_LOGIN);
    expect(attention.querySelector('a')?.getAttribute('rel')).toBe(
      'noreferrer',
    );
    expect(attention.textContent).toContain('학과 미등록');
    expect(attention.querySelector('time')?.dateTime).toBe(
      LAST_ACTIVE.toISOString(),
    );
  });

  it('does not claim 신규 without a comparison year', async () => {
    await act(async () =>
      root.render(
        <StudentsTab
          summary={{
            ...rankingSummary,
            years: [2026],
          }}
        />,
      ),
    );
    const rows =
      section('학생 순위 표').querySelectorAll<HTMLTableRowElement>('tbody tr');
    expect(rows[3].cells[7].textContent).toBe('—');
  });

  it('uses distinct empty states for rank and attention', async () => {
    await act(async () =>
      root.render(
        <StudentsTab
          summary={{
            ...rankingSummary,
            leaders: {
              ...rankingSummary.leaders,
              period: { all: [], swMajor: [], nonSw: [] },
            },
            attentionStudents: [],
          }}
        />,
      ),
    );
    expect(container.textContent).toContain('이 기간에 활동한 학생이 없습니다');
    expect(container.textContent).toContain('관심이 필요한 학생이 없습니다');
    expect(container.querySelector('table')).toBeNull();
  });

  it('exposes metric help on keyboard focus and touch, not as persistent copy', async () => {
    await act(async () =>
      root.render(<StudentsTab summary={rankingSummary} />),
    );
    const trigger = button('협업 비율 설명');
    const tooltip = () => document.body.querySelector('[role="tooltip"]');
    expect(tooltip()).toBeNull();

    await act(async () => trigger.focus());
    expect(tooltip()?.textContent).toContain('(PR + 이슈) ÷ 전체 활동');

    await act(async () => trigger.blur());
    expect(tooltip()).toBeNull();

    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'touch',
          cancelable: true,
        }),
      );
      trigger.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1, cancelable: true }),
      );
    });
    expect(tooltip()?.textContent).toContain('(PR + 이슈) ÷ 전체 활동');
  });

  it('exposes the recent activity definition on mouse hover', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () =>
      root.render(<StudentsTab summary={rankingSummary} />),
    );
    const trigger = button('최근 30일 활동 설명');
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerType: 'mouse',
        }),
      );
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(
      document.body.querySelector('[role="tooltip"]')?.textContent,
    ).toContain('스타는 제외합니다');
  });

  it('offers only calendar periods in the same control and emits the selected scope', async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <PeriodSelect
          scope={{ kind: 'calendar', year: 2024 }}
          years={[2025, 2026]}
          onChange={onChange}
        />,
      ),
    );
    const select = container.querySelector('select');
    expect(
      Array.from(select?.options ?? []).map((option) => option.text),
    ).toEqual(['전체', '2026년', '2025년', '2024년']);
    expect(select?.value).toBe('2024');
    await choose('insights-period', 'all');
    expect(onChange).toHaveBeenCalledWith({ kind: 'all' });
  });

  it('compares department groups by per-student activity while treating unknown as different from zero', async () => {
    const common = {
      ...rankingSummary.departments[0],
      department: '합성 학과',
    };
    const summary = {
      ...rankingSummary,
      departments: [
        {
          ...common,
          major: null,
          activityPerStudent: 1.5,
          recentPerStudent: null,
          sampleTooSmall: true,
        },
        {
          ...common,
          major: '합성 전공',
          activityPerStudent: 5.1,
          recentPerStudent: 0,
        },
      ],
    };
    await act(async () => root.render(<GroupsTab summary={summary} />));
    expect(section('학과·전공 지표').textContent).toContain('학과 수1개');
    expect(container.textContent).not.toContain('기간 미적용');
    const rows =
      section('학과·전공 표').querySelectorAll<HTMLTableRowElement>('tbody tr');
    expect(rows[0].cells[1].textContent).toBe('합성 전공');
    expect(rows[0].cells[4].textContent).toBe('5.1');
    expect(rows[0].cells[5].textContent).toBe('0.0');
    expect(rows[1].cells[1].textContent).toBe('—표본 적음');
    expect(rows[1].cells[5].textContent).toBe('—');
  });

  it('renders the exact finder page including zero activity and uses the server total for navigation', async () => {
    const onQueryChange = vi.fn();
    await act(async () =>
      root.render(
        <FinderTab
          summary={rankingSummary}
          query={finderQuery}
          result={finderResult}
          onQueryChange={onQueryChange}
        />,
      ),
    );
    expect(container.textContent).toContain('검색 결과 53명');
    const finder = section('학생 검색 결과 표');
    const rows = finder.querySelectorAll<HTMLTableRowElement>('tbody tr');
    expect(Array.from(rows[0].cells).map((cell) => cell.textContent)).toEqual([
      '합성 찾기 결과',
      '012345',
      '—',
      '0',
      '—',
      '—',
      rankingSummary.programs[0].name,
    ]);
    expect(rows).toHaveLength(1);
    expect(finder.querySelector('[aria-sort="descending"]')?.textContent).toBe(
      '활동 합계',
    );
    expect(finder.querySelector('[aria-label^="전공 "]')).toBeNull();
    expect(finder.querySelector('input[type="checkbox"]')).toBeNull();
    expect(finder.textContent).not.toContain('급상승');
    expect(container.textContent).not.toContain('CSV');
    const next = Array.from(
      section('학생 검색 결과 페이지').querySelectorAll('button'),
    ).find((candidate) => candidate.textContent === '다음');
    expect(next?.disabled).toBe(false);
    await act(async () => next?.click());
    expect(onQueryChange).toHaveBeenLastCalledWith({ ...finderQuery, page: 3 });
    await act(async () => button('활동 합계 오름차순 정렬').click());
    expect(onQueryChange).toHaveBeenLastCalledWith({
      ...finderQuery,
      direction: 'asc',
      page: 1,
    });
  });

  it('forwards search and each filter to the server and resets the page', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onQueryChange = vi.fn();
    await act(async () =>
      root.render(
        <FinderTab
          summary={rankingSummary}
          query={finderQuery}
          result={finderResult}
          onQueryChange={onQueryChange}
        />,
      ),
    );
    for (const [id, field, value] of [
      ['finder-department', 'department', '소프트웨어공학과'],
      ['finder-program', 'programId', rankingSummary.programs[0].programId],
      ['finder-min-activity', 'minActivity', 200],
      ['finder-recent', 'recentActivity', 'inactive'],
    ] as const) {
      await choose(id, String(value));
      expect(onQueryChange).toHaveBeenLastCalledWith({
        ...finderQuery,
        [field]: value,
        page: 1,
      });
    }
    const search = container.querySelector<HTMLInputElement>('#finder-search');
    if (!search) throw new Error('Missing finder search');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(search, ' 012345 ');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onQueryChange).toHaveBeenCalledTimes(4);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(onQueryChange).toHaveBeenLastCalledWith({
      ...finderQuery,
      search: '012345',
      page: 1,
    });
  });

  it('keeps finder controls available on failure and retries the current request', async () => {
    const onRetry = vi.fn();
    await act(async () =>
      root.render(
        <FinderTab
          summary={rankingSummary}
          query={finderQuery}
          onQueryChange={vi.fn()}
          result={{
            kind: 'error',
            message: '잠시 후 다시 시도해 주세요.',
            onRetry,
          }}
        />,
      ),
    );
    expect(section('학생 찾기 필터').querySelector('input')).not.toBeNull();
    expect(container.textContent).toContain('학생을 불러오지 못했습니다');
    const retry = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === '다시 시도',
    );
    await act(async () => retry?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('distinguishes a pending finder request from an empty result', async () => {
    const onQueryChange = vi.fn();
    await act(async () =>
      root.render(
        <FinderTab
          summary={rankingSummary}
          query={finderQuery}
          onQueryChange={onQueryChange}
          result={{ kind: 'loading' }}
        />,
      ),
    );
    expect(
      container.querySelector('[aria-busy="true"]')?.textContent,
    ).toContain('불러오는 중');
    expect(container.textContent).not.toContain('검색 결과 0명');
    await act(async () =>
      root.render(
        <FinderTab
          summary={rankingSummary}
          query={finderQuery}
          onQueryChange={onQueryChange}
          result={{
            kind: 'ready',
            data: { page: 1, pageSize: 20, rows: [], total: 0 },
          }}
        />,
      ),
    );
    expect(container.textContent).toContain('검색 결과 0명');
    expect(container.textContent).toContain('조건에 맞는 학생이 없습니다');
    expect(
      container.querySelector('[aria-label="학생 검색 결과 페이지"]'),
    ).toBeNull();
  });
});

it('queries only the finder tab and discards an old page when the year changes', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createListScreenRoot(container);
  const stale = Promise.withResolvers<Response>();
  const firstPage = (name: string, page: number) =>
    Response.json({
      rows: [
        {
          name,
          githubLogin: 'synthetic-finder',
          studentId: null,
          major: null,
          total: 0,
          recentTotal: null,
          collaborationRatio: null,
          programIds: [],
        },
      ],
      page,
      pageSize: 20,
      total: 44,
    });
  const studentsPath = apiPath('/dashboard/staff/insights/students');
  const fetchMock = vi.fn<
    (path: string, init?: RequestInit) => Promise<Response>
  >((path) => {
    const url = new URL(path, 'https://example.test');
    const year = Number(url.searchParams.get('year'));
    if (url.pathname.endsWith('/students')) {
      return url.searchParams.get('page') === '2'
        ? stale.promise
        : Promise.resolve(firstPage(`합성 결과 ${year}`, 1));
    }
    return Promise.resolve(
      Response.json({
        ...STAFF_INSIGHTS_FIXTURE,
        scope: { kind: 'calendar', year },
      }),
    );
  });
  const studentRequests = () =>
    fetchMock.mock.calls.filter(([path]) =>
      path.includes('/insights/students'),
    );
  vi.stubGlobal('fetch', fetchMock);

  try {
    listNavigation.search = 'year=2026';
    await act(async () => root.render(<StaffInsightsScreen />));
    expect(
      container.querySelector('[aria-label="학생 순위 표"]'),
    ).not.toBeNull();
    expect(studentRequests()).toHaveLength(0);

    await act(async () => {
      listNavigation.search = 'year=2026&view=finder';
    });
    expect(studentRequests().map(([path]) => path)).toEqual([
      `${studentsPath}?year=2026`,
    ]);
    expect(container.textContent).toContain('합성 결과 2026');

    const next = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '다음',
    );
    if (!next) throw new Error('Missing next page button');
    await act(async () => next.click());
    const [oldPath, request] = studentRequests()[1];
    expect(oldPath).toBe(`${studentsPath}?year=2026&page=2`);
    expect(container.textContent).not.toContain('합성 결과 2026');
    expect(request?.signal?.aborted).toBe(false);
    expect(listNavigation.search).toBe('year=2026&view=finder');

    const select =
      container.querySelector<HTMLSelectElement>('#insights-period');
    if (!select) throw new Error('Missing year select');
    await act(async () => {
      select.value = '2025';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(listNavigation.search).toBe('year=2025&view=finder');
    expect(studentRequests().map(([path]) => path)).toEqual([
      `${studentsPath}?year=2026`,
      `${studentsPath}?year=2026&page=2`,
      `${studentsPath}?year=2025`,
    ]);
    expect(request?.signal?.aborted).toBe(true);
    await act(async () => stale.resolve(firstPage('오래된 합성 결과', 2)));
    expect(container.textContent).toContain('합성 결과 2025');
    expect(container.textContent).not.toContain('오래된 합성 결과');

    await act(async () => {
      listNavigation.search = 'year=2025&view=groups';
    });
    expect(studentRequests()).toHaveLength(3);
    expect(
      container.querySelector('[aria-label="학생 검색 결과 표"]'),
    ).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
