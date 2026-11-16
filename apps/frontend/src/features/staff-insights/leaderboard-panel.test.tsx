import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STAFF_INSIGHTS_FIXTURE } from './fixtures';
import { StudentsTab } from './leaderboard-panel';
import {
  DEPARTMENT_COHORTS,
  type StaffInsightsLeaderRow,
  type StaffInsightsSummary,
} from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function leader(
  rank: number,
  overrides: Partial<StaffInsightsLeaderRow> = {},
): StaffInsightsLeaderRow {
  return {
    rank,
    name: `합성 학생 ${rank}`,
    githubLogin: `synthetic-${rank}`,
    department: '소프트웨어공학과',
    cohort: DEPARTMENT_COHORTS.SW_MAJOR,
    commitCount: 10,
    pullRequestCount: 1,
    issueCount: 1,
    repositoryCount: 1,
    starCount: 2,
    total: 100 - rank * 5,
    ...overrides,
  };
}

const SW_LEADER = leader(1, { name: '합성 SW', githubLogin: 'synthetic-sw' });
const NON_SW_LEADER = leader(2, {
  name: '합성 비SW',
  githubLogin: 'synthetic-nonsw',
  department: '빅데이터융합학과',
  cohort: DEPARTMENT_COHORTS.NON_SW,
});

function withLeaders(
  leaders: StaffInsightsSummary['leaders'],
): StaffInsightsSummary {
  return { ...STAFF_INSIGHTS_FIXTURE, leaders };
}

const EMPTY_LEADERS: StaffInsightsSummary['leaders'] = {
  period: { all: [], swMajor: [], nonSw: [] },
  recent: { all: [], swMajor: [], nonSw: [] },
};

function render(summary: StaffInsightsSummary): string {
  return renderToStaticMarkup(
    <StudentsTab summary={summary} periodLabel="기간 전체" />,
  );
}

function card(html: string, title: string): string {
  const start = html.indexOf(title);
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf('data-slot="card"', start);
  return html.slice(start, end === -1 ? undefined : end);
}

function barWidths(html: string): number[] {
  return [...html.matchAll(/style="width:([^%]+)%"/g)].map((match) =>
    Number(match[1]),
  );
}

describe('StudentsTab', () => {
  it('renders both leaderboards with ranks in order and the period caption', () => {
    const rows = Array.from({ length: 10 }, (_, index) => leader(index + 1));
    const html = render(
      withLeaders({
        period: { all: rows, swMajor: rows, nonSw: [] },
        recent: { all: rows.slice(0, 3), swMajor: [], nonSw: [] },
      }),
    );
    const period = card(html, '기간 전체 상위 10명');
    const ranks = [
      ...period.matchAll(/<span class="inline-flex[^"]*">(\d+)<\/span>/g),
    ].map((match) => Number(match[1]));
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(period).toContain(
      '공개 활동 기준 · Commit · PR · Issue · Repo · Star 합계',
    );
    expect(period).toContain('합성 학생 1');
    expect(period).toContain(
      '<span class="min-w-0 truncate" title="소프트웨어공학과">소프트웨어공학과</span>',
    );
    expect(period).toContain('<span class="shrink-0">@synthetic-1</span>');
    expect(html).toContain('최근 30일 상위 10명');
    expect(html).toContain('aria-label="학생 구분"');
  });

  it('emphasises only the top three rank badges', () => {
    const rows = Array.from({ length: 4 }, (_, index) => leader(index + 1));
    const html = render(
      withLeaders({ ...EMPTY_LEADERS, period: { ...EMPTY_LEADERS.period, all: rows } }),
    );
    const badges = [
      ...html.matchAll(/<span class="(inline-flex[^"]*)">(\d+)<\/span>/g),
    ];
    expect(badges.map((match) => match[1]?.includes('bg-primary'))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(badges[3]?.[1]).toContain('bg-muted');
  });

  it('falls back to the GitHub login when the name is null and labels a missing department', () => {
    const html = render(STAFF_INSIGHTS_FIXTURE);
    const period = card(html, '기간 전체 상위 10명');
    expect(period).toContain('<p class="truncate font-medium">synthetic-b</p>');
    expect(period).toContain(
      '<span class="min-w-0 truncate" title="학과 미등록">학과 미등록</span>',
    );
    expect(period).toContain('<span class="shrink-0">@synthetic-b</span>');
  });

  it('describes the recent window without any Star count', () => {
    const html = render(STAFF_INSIGHTS_FIXTURE);
    const recent = card(html, '최근 30일 상위 10명');
    const { from, to } = STAFF_INSIGHTS_FIXTURE.recentWindow;
    expect(recent).toContain(
      `Commit · PR · Issue · Repo 증가분, Star 제외 · ${from.toLocaleDateString('ko-KR')}~${to.toLocaleDateString('ko-KR')} · 기준 ${STAFF_INSIGHTS_FIXTURE.dataAsOf?.toLocaleString('ko-KR')}`,
    );
    expect(recent).not.toContain('Star 합계');
    expect(recent).toContain('>39</span>');
  });

  it('renders both empty states when no student has activity', () => {
    const html = render(withLeaders(EMPTY_LEADERS));
    expect(html).toContain('이 기간에 활동한 학생이 없습니다');
    expect(html).toContain('최근 30일에 늘어난 활동이 없습니다');
    expect(html).not.toContain('<ol');
  });

  it('keeps bar widths finite and full when every total is equal', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      leader(index + 1, { total: 7 }),
    );
    const html = render(
      withLeaders({ ...EMPTY_LEADERS, period: { ...EMPTY_LEADERS.period, all: rows } }),
    );
    expect(barWidths(html)).toEqual(Array.from({ length: 10 }, () => 100));
  });

  it('guards the bar width against a zero maximum and scales proportionally', () => {
    const html = render(
      withLeaders({
        ...EMPTY_LEADERS,
        period: {
          ...EMPTY_LEADERS.period,
          all: [leader(1, { total: 40 }), leader(2, { total: 10 })],
        },
        recent: {
          ...EMPTY_LEADERS.recent,
          all: [leader(1, { total: 0, name: null })],
        },
      }),
    );
    expect(barWidths(html)).toEqual([100, 25, 0]);
    expect(html).not.toContain('NaN');
    expect(html).toContain('<p class="truncate font-medium">synthetic-1</p>');
  });

  describe('cohort filter', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    });

    afterEach(async () => {
      await act(async () => root.unmount());
      container.remove();
    });

    it('switches to the SW list and hides non-SW students without refetching', async () => {
      const summary = withLeaders({
        period: {
          all: [SW_LEADER, NON_SW_LEADER],
          swMajor: [SW_LEADER],
          nonSw: [{ ...NON_SW_LEADER, rank: 1 }],
        },
        recent: {
          all: [SW_LEADER, NON_SW_LEADER],
          swMajor: [SW_LEADER],
          nonSw: [{ ...NON_SW_LEADER, rank: 1 }],
        },
      });
      await act(async () => {
        root.render(<StudentsTab summary={summary} periodLabel="2026년" />);
      });
      expect(container.textContent).toContain('합성 비SW');

      const chip = (label: string) =>
        [
          ...container.querySelectorAll<HTMLButtonElement>(
            '[aria-label="학생 구분"] button',
          ),
        ].find((button) => button.textContent === label);
      expect(chip('전체')?.getAttribute('aria-pressed')).toBe('true');

      await act(async () => chip('SW전공')?.click());
      expect(chip('SW전공')?.getAttribute('aria-pressed')).toBe('true');
      expect(container.textContent).toContain('합성 SW');
      expect(container.textContent).not.toContain('합성 비SW');

      await act(async () => chip('비SW전공')?.click());
      expect(container.textContent).toContain('합성 비SW');
      expect(container.textContent).not.toContain('합성 SW');
      expect(container.querySelectorAll('li')).toHaveLength(2);
    });
  });
});
