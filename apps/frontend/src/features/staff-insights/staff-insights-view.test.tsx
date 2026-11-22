import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { getStaffInsightsStudents } from './api';
import { STAFF_INSIGHTS_FIXTURE } from './fixtures';
import type { StaffInsightsFinderProps } from './leaderboard-panel';
import {
  buildStaffInsightsSearchParams,
  parseStaffInsightsSearchParams,
} from './staff-insights-url-state';
import { StaffInsightsView } from './staff-insights-view';
import type { InsightsView, InsightsYearScope } from './types';

const FINDER_QUERY: StaffInsightsFinderProps['query'] = {
  search: '',
  department: '',
  programId: '',
  minActivity: 0,
  recentActivity: 'all',
  sort: 'total',
  direction: 'desc',
  page: 1,
};

const FINDER_PAGE = {
  rows: [
    {
      name: '합성 찾기 학생',
      githubLogin: 'synthetic-finder',
      studentId: '012345',
      major: null,
      total: 0,
      recentTotal: null,
      collaborationRatio: null,
      programIds: [],
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
};

function render(
  view: InsightsView,
  scope: InsightsYearScope = { kind: 'all' },
): string {
  const ready = {
    kind: 'ready' as const,
    summary: { ...STAFF_INSIGHTS_FIXTURE, scope },
    onScopeChange: () => undefined,
  };
  if (view !== 'finder') {
    return renderToStaticMarkup(
      <StaffInsightsView state={{ ...ready, view }} />,
    );
  }
  return renderToStaticMarkup(
    <StaffInsightsView
      state={{
        ...ready,
        view,
        finder: {
          query: FINDER_QUERY,
          onQueryChange: () => undefined,
          result: { kind: 'ready', data: FINDER_PAGE },
        },
      }}
    />,
  );
}

function tabBar(html: string): string {
  const start = html.indexOf('aria-label="인사이트 보기"');
  return html.slice(start, html.indexOf('</nav>', start));
}

describe('StaffInsightsView', () => {
  it('shows four underline tabs above one calendar period control', () => {
    const html = render('students', { kind: 'calendar', year: 2026 });
    expect(html).toContain('인사이트');
    expect(html).toContain('for="insights-period"');
    expect(html.match(/<select\b/g)).toHaveLength(1);
    expect(html).toContain('<option value="2026" selected="">2026년</option>');
    expect(html).toContain('<option value="all">전체</option>');
    const tabs = tabBar(html);
    expect(tabs.match(/<a /g)).toHaveLength(4);
    for (const title of ['순위', '학생 찾기', '학과·전공', '프로그램']) {
      expect(tabs).toContain(`>${title}</a>`);
    }
    expect(tabs.indexOf('>순위</a>')).toBeLessThan(
      tabs.indexOf('>학생 찾기</a>'),
    );
    expect(html.indexOf('aria-label="인사이트 보기"')).toBeLessThan(
      html.indexOf('for="insights-period"'),
    );
  });

  it.each([
    ['students', '학생 순위 표'],
    ['finder', '학생 검색 결과 표'],
    ['groups', '학과·전공 표'],
    ['programs', '프로그램 성과표'],
  ] as const)('renders only the %s tab body', (view, label) => {
    const html = render(view);
    const labels = [
      '학생 순위 표',
      '학생 검색 결과 표',
      '학과·전공 표',
      '프로그램 성과표',
    ];
    for (const other of labels) {
      expect(html.includes(`aria-label="${other}"`)).toBe(label === other);
    }
  });

  it('renders the loading and error states without tabs', () => {
    const loading = renderToStaticMarkup(
      <StaffInsightsView state={{ kind: 'loading' }} />,
    );
    expect(loading).toContain('인사이트를 불러오는 중');
    expect(loading).not.toContain('aria-label="인사이트 보기"');

    const error = renderToStaticMarkup(
      <StaffInsightsView
        state={{
          kind: 'error',
          message: '승인된 교직원 또는 관리자만 조회할 수 있습니다.',
          onRetry: () => undefined,
        }}
      />,
    );
    expect(error).toContain('인사이트를 불러오지 못했습니다');
    expect(error).toContain('승인된 교직원 또는 관리자만 조회할 수 있습니다.');
    expect(error).not.toContain('aria-label="인사이트 보기"');
  });

  it('marks finder as current and keeps only the year and view in its link', () => {
    const html = render('finder', { kind: 'calendar', year: 2026 });
    const current = tabBar(html).match(/<a[^>]*aria-current="page"[^>]*>/g);
    expect(current).toHaveLength(1);
    expect(current?.[0]).toContain('aria-[current=page]:border-primary');
    expect(current?.[0]).toContain(
      'href="/dashboard/insights?year=2026&amp;view=finder"',
    );
    expect(tabBar(html)).toContain('href="/dashboard/insights?year=2026"');
    expect(tabBar(html)).not.toContain('012345');

    const urlState = parseStaffInsightsSearchParams(
      new URLSearchParams('view=finder&year=2026&search=012345&page=3'),
    );
    expect(urlState).toEqual({
      view: 'finder',
      scope: { kind: 'calendar', year: 2026 },
    });
    expect(buildStaffInsightsSearchParams(urlState).toString()).toBe(
      'year=2026&view=finder',
    );
  });

  it('shows the program KPI strip and scorecard on the programs tab', () => {
    const html = render('programs');
    expect(html).toContain('aria-label="프로그램 지표"');
    expect(html).toContain('현재 기준 · 기간 미적용');
    expect(html).toContain('aria-label="프로그램 성과표"');
    expect(html).toContain('학과 미등록');
    expect(html).not.toContain('recharts');
    const names = Array.from(
      html.matchAll(/data-slot="program-name"[^>]*>([^<]+)</g),
      ([, name]) => name,
    );
    expect(names).toEqual([
      '합성 기초 오픈소스 스터디',
      '합성 캡스톤 2026',
      '합성 OSS 경진대회',
      '합성 기업인턴십 모집',
    ]);
  });

  it('keeps the programs empty state when no program is published', () => {
    const html = renderToStaticMarkup(
      <StaffInsightsView
        state={{
          kind: 'ready',
          summary: { ...STAFF_INSIGHTS_FIXTURE, programs: [] },
          onScopeChange: () => undefined,
          view: 'programs',
        }}
      />,
    );
    expect(html).toContain('운영 중인 프로그램이 없습니다');
    expect(html).not.toContain('<table');
  });
});

describe('staff insights finder API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the complete request with an abort signal and preserves null versus zero', async () => {
    const query = {
      search: '012345 & 합성',
      department: '합성 학과',
      programId: 'synthetic-program',
      minActivity: 200,
      recentActivity: 'inactive' as const,
      sort: 'studentId' as const,
      direction: 'asc' as const,
      page: 3,
    };
    const wire = {
      ...FINDER_PAGE,
      rows: [{ ...FINDER_PAGE.rows[0], unexpected: true }],
      page: 3,
      total: 41,
    };
    const fetchMock = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(Response.json(wire));
    vi.stubGlobal('fetch', fetchMock);
    const { signal } = new AbortController();
    const result = await getStaffInsightsStudents(
      { kind: 'calendar', year: 2025 },
      query,
      signal,
    );

    const [path, options] = fetchMock.mock.calls[0];
    const url = new URL(path, 'https://example.test');
    expect(url.pathname).toBe(apiPath('/dashboard/staff/insights/students'));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ...query,
      year: '2025',
      minActivity: '200',
      page: '3',
    });
    expect(options).toEqual({ signal, cache: 'no-store' });
    expect(result).toEqual({ ...FINDER_PAGE, page: 3, total: 41 });
  });

  it.each([
    { ...FINDER_PAGE, pageSize: 0 },
    {
      ...FINDER_PAGE,
      rows: [{ ...FINDER_PAGE.rows[0], collaborationRatio: 1.5 }],
    },
    { ...FINDER_PAGE, rows: [{ ...FINDER_PAGE.rows[0], recentTotal: '0' }] },
  ])('rejects malformed finder pagination or metrics', async (wire) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(wire)));
    await expect(
      getStaffInsightsStudents(
        { kind: 'all' },
        FINDER_QUERY,
        new AbortController().signal,
      ),
    ).rejects.toThrow('학생 검색 API 응답 형식이 올바르지 않습니다.');
  });
});
