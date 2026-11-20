import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStaffDashboardPageModel,
  StaffDashboardOverview,
  StaffDashboardPageView,
} from './staff-dashboard-page';
import { parseStaffDashboardSummary } from './staff-dashboard-parser';
import {
  staffDashboardProgram,
  staffDashboardSummary as summary,
  staffDashboardSummaryOf,
} from './staff-dashboard-test-fixtures';
import type {
  StaffDashboardMilestoneSummary,
  StaffDashboardProgramSummary,
} from './dto';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const [fixtureProgram] = summary.programs;
if (fixtureProgram === undefined) {
  throw new Error('Expected the staff dashboard fixture to include a program.');
}

const now = new Date('2026-11-19T05:00:00.000Z');

const first: StaffDashboardMilestoneSummary = {
  id: 'first',
  name: '착수 보고',
  startAt: '2026-11-01T00:00:00.000Z',
  dueAt: '2026-11-08T14:59:00.000Z',
  submittedTeams: 9,
  totalTeams: 12,
};
const middle: StaffDashboardMilestoneSummary = {
  id: 'middle',
  name: '중간 보고',
  startAt: '2026-11-09T00:00:00.000Z',
  dueAt: '2026-11-17T14:59:00.000Z',
  submittedTeams: 5,
  totalTeams: 12,
};
const final: StaffDashboardMilestoneSummary = {
  id: 'final',
  name: '최종 보고',
  startAt: '2026-11-20T00:00:00.000Z',
  dueAt: '2026-11-26T14:59:00.000Z',
  submittedTeams: 0,
  totalTeams: 12,
};
const operating = staffDashboardProgram({
  id: 'program:operating',
  name: '운영 프로그램',
  milestones: [final, first, middle],
});
const recruiting = staffDashboardProgram({
  id: 'program:recruiting',
  name: '모집 프로그램',
  applicationPeriod: {
    startsAt: '2026-11-15T00:00:00.000Z',
    endsAt: '2026-11-21T14:59:00.000Z',
  },
  milestones: [middle],
});

function element<T extends Element>(scope: ParentNode, selector: string): T {
  const match = scope.querySelector<T>(selector);
  if (match === null) throw new Error(`Missing ${selector}`);
  return match;
}

describe('staff dashboard parser and model', () => {
  it('신청, 활동, 제출 요약이 있는 응답만 허용한다', () => {
    expect(parseStaffDashboardSummary(summary)).toEqual(summary);
    expect(() =>
      parseStaffDashboardSummary({
        ...summary,
        programs: [
          {
            ...fixtureProgram,
            applications: {
              total: 3,
              submitted: 1,
              pendingApproval: 0,
              approved: 1,
              rejected: 1,
            },
          },
        ],
      }),
    ).toThrow('운영 대시보드 응답 형식이 올바르지 않습니다.');
    expect(() =>
      parseStaffDashboardSummary({
        ...summary,
        programs: [
          {
            ...fixtureProgram,
            submissions: {
              ...fixtureProgram.submissions,
              total: 99,
            },
          },
        ],
      }),
    ).toThrow('운영 대시보드 응답 형식이 올바르지 않습니다.');
  });

  it('종료일 부재는 거부하고 게시 상태는 있든 없든 읽는다', () => {
    const withoutEndAt = { ...fixtureProgram };
    Reflect.deleteProperty(withoutEndAt, 'endAt');
    const withLegacyLifecycle = { ...fixtureProgram, lifecycle: 'PUBLISHED' };

    expect(() =>
      parseStaffDashboardSummary(staffDashboardSummaryOf([withoutEndAt])),
    ).toThrow('운영 대시보드 응답 형식이 올바르지 않습니다.');
    expect(
      parseStaffDashboardSummary(staffDashboardSummaryOf([fixtureProgram])),
    ).toEqual(staffDashboardSummaryOf([fixtureProgram]));
    expect(
      parseStaffDashboardSummary(
        staffDashboardSummaryOf([withLegacyLifecycle]),
      ),
    ).toEqual(staffDashboardSummaryOf([withLegacyLifecycle]));
  });

  it('빈 목록과 검색 결과 없음을 구분한다', () => {
    const empty = buildStaffDashboardPageModel(staffDashboardSummaryOf([]));
    const noResults = buildStaffDashboardPageModel(
      staffDashboardSummaryOf(summary.programs, { total: 0 }),
    );
    expect(empty.isEmptyCatalog).toBe(true);
    expect(empty.isNoResults).toBe(false);
    expect(noResults.isEmptyCatalog).toBe(false);
    expect(noResults.isNoResults).toBe(true);
  });
});

describe('StaffDashboardOverview', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function renderOverview(
    programs: readonly StaffDashboardProgramSummary[],
    overrides: Partial<ComponentProps<typeof StaffDashboardOverview>> = {},
  ): Promise<HTMLTableElement> {
    await act(async () =>
      root.render(
        <StaffDashboardOverview
          programs={programs}
          now={now}
          onSortChange={vi.fn()}
          {...overrides}
        />,
      ),
    );
    return element<HTMLTableElement>(container, 'table');
  }

  it('다섯 열과 실제 처리 대기를 표시하고 서버가 정렬한 행 순서를 유지한다', async () => {
    const noPending = {
      ...recruiting,
      applications: { total: 0, pendingApproval: 0, approved: 0, rejected: 0 },
      submissions: { ...recruiting.submissions, submitted: 0 },
    };
    const table = await renderOverview([noPending, operating]);
    expect(
      Array.from(
        table.querySelectorAll('thead th'),
        (head) => head.textContent,
      ),
    ).toEqual(['프로그램', '현재 단계', '단계 마감', '제출', '처리 대기']);
    expect(
      Array.from(
        table.querySelectorAll('tbody th'),
        (head) => head.textContent,
      ),
    ).toEqual([noPending.name, operating.name]);
    expect(
      element(table, 'tbody tr:first-child td:last-child').textContent,
    ).toBe('—');
    expect(
      element(table, 'tbody tr:last-child td:last-child').textContent,
    ).toBe(' 검토 1 신청 1');
    expect(container.textContent).not.toMatch(
      /저장소 없음|마일스톤 없음|대상 0|처리할 일 많은 순/,
    );
    const mobileRows = container.querySelectorAll(
      'ul[aria-label="프로그램 운영 현황"] > li',
    );
    expect(mobileRows).toHaveLength(2);
    expect(mobileRows[1]?.children).toHaveLength(2);
    expect(mobileRows[0]?.textContent).not.toContain('—');
  });

  it.each([
    ['데스크톱', 'table tbody th a'],
    ['모바일', 'ul[aria-label="프로그램 운영 현황"] > li a'],
  ])('%s 프로그램 이름 링크는 프로그램 개요를 연다', async (_, selector) => {
    await renderOverview([operating]);
    const link = element<HTMLAnchorElement>(container, selector);

    expect(link.getAttribute('href')).toBe('/programs/program%3Aoperating');

    expect(link.textContent).toBe('운영 프로그램');
    expect(link.hasAttribute('aria-label')).toBe(false);
    expect(link.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('활성 열에만 정렬 속성을 두고 새 열은 지정된 방향으로, 같은 열은 반대로 요청한다', async () => {
    const onSortChange = vi.fn();
    const table = await renderOverview([operating], { onSortChange });
    expect(table.querySelectorAll('th[aria-sort]')).toHaveLength(1);
    const defaultHeader = element(table, 'th[aria-sort="descending"]');
    expect(defaultHeader.textContent).toBe('처리 대기');
    expect(
      table.querySelector('thead th:last-child svg.lucide-chevron-down'),
    ).not.toBeNull();
    await act(async () =>
      element<HTMLButtonElement>(defaultHeader, 'button').click(),
    );
    expect(onSortChange).toHaveBeenLastCalledWith({
      sort: 'pending',
      direction: 'asc',
    });

    for (const [column, sort] of [
      [1, 'name'],
      [3, 'deadline'],
      [4, 'submission'],
    ] as const) {
      await act(async () =>
        element<HTMLButtonElement>(
          table,
          `thead th:nth-child(${column}) button`,
        ).click(),
      );
      expect(onSortChange).toHaveBeenLastCalledWith({ sort, direction: 'asc' });
    }
    await renderOverview([operating], {
      order: { sort: 'deadline', direction: 'asc' },
      onSortChange,
    });
    expect(table.querySelectorAll('th[aria-sort]')).toHaveLength(1);
    expect(element(table, 'th[aria-sort="ascending"]').textContent).toBe(
      '단계 마감',
    );
    await act(async () =>
      element<HTMLButtonElement>(table, 'th[aria-sort] button').click(),
    );
    expect(onSortChange).toHaveBeenLastCalledWith({
      sort: 'deadline',
      direction: 'desc',
    });
    await act(async () =>
      element<HTMLButtonElement>(table, 'thead th:last-child button').click(),
    );
    expect(onSortChange).toHaveBeenLastCalledWith({
      sort: 'pending',
      direction: 'desc',
    });
  });

  it('다음 단계가 시작할 때까지 지난 단계의 실제 마감과 제출을 표시한다', async () => {
    const table = await renderOverview([operating]);
    const stage = element(table, 'tbody td:nth-child(2) button');
    expect(stage.textContent).toBe('중간 보고');
    expect(stage.getAttribute('aria-label')).toBe(
      '1 착수 보고 · 마감 / 2 중간 보고 · 진행 중 / 3 최종 보고',
    );
    expect(stage.querySelectorAll('.bg-primary')).toHaveLength(2);
    expect(stage.querySelectorAll('.bg-muted')).toHaveLength(1);

    const deadline = element(table, 'tbody td:nth-child(3) button');
    expect(deadline.textContent).toBe('11.17 (화) 마감');
    expect(element<HTMLTimeElement>(deadline, 'time').dateTime).toBe(
      middle.dueAt,
    );
    expect(deadline.querySelector('svg')).not.toBeNull();
    expect(deadline.textContent).not.toMatch(/지남|D\+/);

    const submission = element(table, 'tbody td:nth-child(4) button');
    expect(submission.textContent).toBe('');
    expect(submission.getAttribute('aria-label')).toBe(
      '제출 5팀 · 미제출 7팀 (전체 12팀)',
    );
    expect(container.textContent).not.toMatch(/\d\s*\/\s*\d|14:59|23:59/);
  });

  it('서울 자정으로 D-day를 바꾸고 실제 마감 시각 직후 같은 날에도 마감으로 표시한다', async () => {
    const dueAt = '2026-11-19T15:05:00.000Z';
    const program = { ...operating, milestones: [{ ...middle, dueAt }] };
    const deadline = () => element(container, 'tbody td:nth-child(3) button');
    await renderOverview([program], {
      now: new Date('2026-11-19T14:59:59.000Z'),
    });
    expect(deadline().textContent).toBe('11.20 (금) D-1');
    await renderOverview([program], { now: new Date(dueAt) });
    expect(deadline().textContent).toBe('11.20 (금) D-day');
    await renderOverview([program], {
      now: new Date('2026-11-19T15:05:00.001Z'),
    });
    expect(deadline().textContent).toBe('11.20 (금) 마감');
  });

  it('모집 마감을 단계 대신 표시하고 모집 전, 종료, 첫 단계 전의 마감을 추정하지 않는다', async () => {
    const upcoming = {
      ...recruiting,
      id: 'upcoming',
      applicationPeriod: {
        ...recruiting.applicationPeriod,
        startsAt: '2026-11-20T00:00:00.000Z',
      },
    };
    const ended = {
      ...operating,
      id: 'ended',
      endAt: '2026-11-18T00:00:00.000Z',
    };
    const beforeStage = {
      ...operating,
      id: 'before-stage',
      milestones: [final],
    };
    const table = await renderOverview([
      recruiting,
      upcoming,
      ended,
      beforeStage,
    ]);
    expect(
      Array.from(
        table.querySelectorAll('tbody td:nth-child(2)'),
        (cell) => cell.textContent,
      ),
    ).toEqual(['모집', '모집 전', '종료', '—']);
    expect(
      Array.from(
        table.querySelectorAll('tbody td:nth-child(3)'),
        (cell) => cell.textContent,
      ),
    ).toEqual(['11.21 (토) D-2', '—', '—', '—']);
    expect(table.querySelectorAll('tbody time')).toHaveLength(1);
    const mobileWeekday = element(container, 'ul li:first-child time span');
    expect(mobileWeekday.classList).toContain('hidden');
    expect(mobileWeekday.classList).toContain('sm:inline');
  });

  it('동시 시작한 단계는 마감과 ID 순으로 고르고 시작 시각 자체를 포함한다', async () => {
    const startAt = now.toISOString();
    const tiedLatest = {
      ...final,
      startAt,
      id: 'stage-z',
      name: '동률 최신 단계',
    };
    const tiedEarlier = {
      ...tiedLatest,
      id: 'stage-a',
      name: '동률 이전 단계',
    };
    const earlierDue = {
      ...tiedLatest,
      id: 'stage-zz',
      dueAt: '2026-11-25T00:00:00.000Z',
    };
    const table = await renderOverview([
      { ...operating, milestones: [tiedLatest, tiedEarlier, earlierDue] },
    ]);
    expect(element(table, 'tbody td:nth-child(2)').textContent).toBe(
      tiedLatest.name,
    );
    expect(element(table, 'tbody time').getAttribute('datetime')).toBe(
      tiedLatest.dueAt,
    );
  });

  it('미제출 0팀과 제출률을 계산할 수 없는 단계를 구분한다', async () => {
    const table = await renderOverview([
      {
        ...operating,
        id: 'not-applicable',
        milestones: [{ ...middle, submittedTeams: null, totalTeams: null }],
      },
      {
        ...operating,
        id: 'no-teams',
        milestones: [{ ...middle, submittedTeams: 0, totalTeams: 0 }],
      },
      {
        ...operating,
        id: 'zero-submitted',
        milestones: [{ ...middle, submittedTeams: 0 }],
      },
    ]);
    const cells = table.querySelectorAll('tbody td:nth-child(4)');
    expect(cells[0]?.textContent).toBe('—');
    expect(cells[1]?.textContent).toBe('—');
    expect(cells[2]?.querySelector('button')?.getAttribute('aria-label')).toBe(
      '제출 0팀 · 미제출 12팀 (전체 12팀)',
    );
    expect(
      cells[2]?.querySelector<HTMLElement>('.bg-primary')?.style.width,
    ).toBe('0%');
    expect(
      container.querySelectorAll('ul button[aria-label^="제출 "]'),
    ).toHaveLength(1);
  });

  it('포커스와 호버는 툴팁을 열고 닫고 모바일에서는 같은 표시를 두 번 탭할 수 있다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const table = await renderOverview([operating]);
    const tooltip = () => document.querySelector('[role="tooltip"]');
    const stage = element<HTMLButtonElement>(
      table,
      'tbody td:nth-child(2) button',
    );
    const deadline = element<HTMLButtonElement>(
      table,
      'tbody td:nth-child(3) button',
    );
    const submission = element<HTMLButtonElement>(
      container,
      'ul button[aria-label^="제출 "]',
    );

    await act(async () => deadline.focus());
    expect(tooltip()?.textContent).toBe('2026년 11월 17일 (화) 23:59 마감');
    await act(async () => deadline.blur());
    expect(tooltip()).toBeNull();

    await act(async () => {
      stage.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerType: 'mouse',
        }),
      );
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(tooltip()?.textContent).toContain('2 중간 보고 · 진행 중');
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(tooltip()).toBeNull();

    async function tap() {
      await act(async () => {
        submission.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerType: 'touch',
          }),
        );
        submission.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            pointerType: 'touch',
          }),
        );
        submission.click();
      });
    }
    await tap();
    expect(tooltip()?.textContent).toBe('제출 5팀 · 미제출 7팀 (전체 12팀)');
    await tap();
    expect(tooltip()).toBeNull();
  });
});

describe('StaffDashboardPageView', () => {
  it('준비된 화면에는 머리말 설명, 모집 요약과 검색 필터를 렌더하지 않는다', () => {
    const html = renderToStaticMarkup(
      <StaffDashboardPageView
        state={{
          kind: 'ready',
          model: buildStaffDashboardPageModel(summary),
          now,
          actions: {
            onResetFilters: vi.fn(),
            onPageChange: vi.fn(),
            onSortChange: vi.fn(),
          },
        }}
      />,
    );

    expect(html).toContain('<h1');
    expect(html).not.toMatch(
      /page-header-description|전체 프로그램 모집 상태|<input|<select/,
    );
    expect(html).not.toContain('마감 알림 지금 발송');
    expect(html).not.toContain('deadline-digests/send');
  });

  it('검색 결과 없음과 빈 프로그램 목록 상태를 별도로 렌더한다', () => {
    const actions = {
      onResetFilters: vi.fn(),
      onPageChange: vi.fn(),
      onSortChange: vi.fn(),
    };
    const emptyHtml = renderToStaticMarkup(
      <StaffDashboardPageView
        state={{
          kind: 'ready',
          model: buildStaffDashboardPageModel(staffDashboardSummaryOf([])),
          now,
          actions,
        }}
      />,
    );
    const noResultsHtml = renderToStaticMarkup(
      <StaffDashboardPageView
        state={{
          kind: 'ready',
          model: buildStaffDashboardPageModel(
            staffDashboardSummaryOf(summary.programs, { total: 0 }),
          ),
          now,
          actions,
        }}
      />,
    );
    expect(emptyHtml).toContain('등록된 프로그램이 없습니다');
    expect(emptyHtml.match(/프로그램 만들기/g)).toHaveLength(1);
    expect(emptyHtml).not.toContain('검색 결과가 없습니다');
    expect(noResultsHtml).toContain('검색 결과가 없습니다');
    expect(noResultsHtml).toContain('필터 초기화');
    expect(noResultsHtml).not.toContain('등록된 프로그램이 없습니다');
  });
});
