import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankingTimeline } from '../types';
import {
  biggestClimb,
  buildRows,
  rankTicks,
  stackLabels,
} from './ranking-bump-chart-model';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const chart = vi.hoisted(() => ({
  onMouseMove: undefined as
    undefined | ((state: unknown, event: unknown) => void),
}));

vi.mock('./comic-font', () => ({ comicNeue: { variable: 'font-comic' } }));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { readonly children: ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({
    children,
    onMouseMove,
  }: {
    readonly children: ReactNode;
    readonly onMouseMove?: (state: unknown, event: unknown) => void;
  }) => {
    chart.onMouseMove = onMouseMove;
    return <svg data-chart="">{children}</svg>;
  },
  XAxis: () => null,
  YAxis: () => null,
  ZIndexLayer: ({ children }: { readonly children: ReactNode }) => (
    <g data-layer="">{children}</g>
  ),
  Line: ({
    dataKey,
    stroke,
    strokeWidth,
    className,
    'data-viewer-line': viewerLine,
  }: {
    readonly dataKey: string;
    readonly stroke?: string;
    readonly strokeWidth?: number;
    readonly className?: string;
    readonly 'data-viewer-line'?: string;
  }) => (
    <g
      data-line={dataKey}
      data-stroke={stroke}
      data-stroke-width={strokeWidth}
      className={className}
      {...(viewerLine === undefined ? {} : { 'data-viewer-line': viewerLine })}
    />
  ),
  usePlotArea: () => ({ x: 56, y: 28, width: 800, height: 300 }),
  useXAxisScale: () => (value: unknown) =>
    typeof value === 'string'
      ? 56 + 60 * Number(value.replace(/\D/gu, ''))
      : undefined,
  useYAxisScale: () => (rank: unknown) =>
    typeof rank === 'number' ? 28 + rank * 10 : undefined,
  useXAxisTicks: () => [{ coordinate: 100 }],
  useYAxisTicks: () => [{ coordinate: 50 }],
}));

import { RankingBumpChart } from './ranking-bump-chart';

function timelineFixture(
  overrides: Partial<RankingTimeline> = {},
): RankingTimeline {
  return {
    year: 2026,
    viewerClass: 'member',
    viewerGithubLogin: 'synthetic-two',
    dataAsOf: new Date('2026-03-19T02:30:00.000Z'),
    points: [
      { date: '2026-01-31', starEstimated: true },
      { date: '2026-02-28', starEstimated: true },
      { date: '2026-03-19', starEstimated: false },
    ],
    series: [
      { githubLogin: 'synthetic-one', ranks: [2, 1, 1], totals: [10, 20, 30] },
      { githubLogin: 'synthetic-two', ranks: [1, 2, 2], totals: [12, 18, 24] },
      {
        githubLogin: 'synthetic-three',
        ranks: [null, 3, 3],
        totals: [null, 5, 9],
      },
    ],
    ...overrides,
  };
}

function stubMotionPreference(matches: boolean): void {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('RankingBumpChart', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    chart.onMouseMove = undefined;
    stubMotionPreference(false);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function render(timeline: RankingTimeline) {
    await act(async () =>
      root.render(<RankingBumpChart timeline={timeline} />),
    );
  }
  function rootElement(): HTMLElement {
    const found = container.querySelector<HTMLElement>(
      '[data-revealed-points]',
    );
    if (!found) throw new Error('chart root missing');
    return found;
  }
  function revealed(): string | null {
    return rootElement().getAttribute('data-revealed-points');
  }
  function button(label: string): HTMLButtonElement {
    const found = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((candidate) => candidate.textContent?.includes(label) === true);
    if (!found) throw new Error(`button missing: ${label}`);
    return found;
  }

  it('참가자마다 선을 하나씩 긋고 내 선만 굵게 강조한다', async () => {
    await render(timelineFixture());

    expect(container.querySelectorAll('.rank-line')).toHaveLength(3);
    const viewerLines =
      container.querySelectorAll<HTMLElement>('[data-viewer-line]');
    expect(viewerLines).toHaveLength(1);
    expect(viewerLines[0].getAttribute('data-stroke-width')).toBe('4');
    expect(viewerLines[0].getAttribute('data-line')).toBe('s1');
    expect(
      container.querySelector('[data-line="s1"].rank-line--viewer'),
    ).not.toBeNull();
  });

  it('비로그인 뷰어에게는 내 선 강조가 없다', async () => {
    await render(
      timelineFixture({ viewerClass: 'public', viewerGithubLogin: null }),
    );

    expect(container.querySelectorAll('[data-viewer-line]')).toHaveLength(0);
    expect(container.querySelectorAll('.rank-line')).toHaveLength(3);
  });

  it('재생을 누르면 700ms마다 한 달씩 공개하고 마지막 달에서 멈춘다', async () => {
    vi.useFakeTimers();
    await render(timelineFixture());
    expect(revealed()).toBe('3');

    await act(async () => button('재생').click());
    expect(revealed()).toBe('1');
    expect(button('정지')).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(revealed()).toBe('2');

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(revealed()).toBe('3');

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(revealed()).toBe('3');
    expect(button('재생')).toBeDefined();
  });

  it('정지하면 그 자리에 멈추고 다시 누르면 이어서 공개한다', async () => {
    vi.useFakeTimers();
    await render(timelineFixture());

    await act(async () => button('재생').click());
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(revealed()).toBe('2');

    await act(async () => button('정지').click());
    await act(async () => {
      vi.advanceTimersByTime(1400);
    });
    expect(revealed()).toBe('2');

    await act(async () => button('재생').click());
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(revealed()).toBe('3');
  });

  it('모션을 줄이는 설정이면 전부 공개하고 재생 버튼을 숨긴다', async () => {
    stubMotionPreference(true);
    await render(timelineFixture());

    expect(revealed()).toBe('3');
    expect(
      Array.from(container.querySelectorAll('button')).map(
        (node) => node.textContent,
      ),
    ).not.toContain('재생');
  });

  it('달이 하나뿐이면 재생 버튼을 만들지 않는다', async () => {
    await render(
      timelineFixture({
        points: [{ date: '2026-03-19', starEstimated: false }],
        series: [
          { githubLogin: 'synthetic-one', ranks: [1] },
          { githubLogin: 'synthetic-two', ranks: [2] },
        ],
      }),
    );

    expect(revealed()).toBe('1');
    expect(container.textContent).not.toContain('재생');
  });

  it('추정 달이 있을 때만 각주를 단다', async () => {
    await render(timelineFixture());
    expect(
      container.querySelector('[data-star-estimated-note]'),
    ).not.toBeNull();

    await render(
      timelineFixture({
        points: [
          { date: '2026-01-31', starEstimated: false },
          { date: '2026-02-28', starEstimated: false },
          { date: '2026-03-19', starEstimated: false },
        ],
      }),
    );
    expect(container.querySelector('[data-star-estimated-note]')).toBeNull();
  });

  it('조직 멤버십 안내는 로그인 사용자에게만 보인다', async () => {
    await render(timelineFixture());
    expect(
      container.querySelector('[data-org-membership-hint]'),
    ).not.toBeNull();

    await render(
      timelineFixture({ viewerClass: 'staff', viewerGithubLogin: null }),
    );
    expect(
      container.querySelector('[data-org-membership-hint]'),
    ).not.toBeNull();

    await render(
      timelineFixture({ viewerClass: 'public', viewerGithubLogin: null }),
    );
    expect(container.querySelector('[data-org-membership-hint]')).toBeNull();
  });

  it('칩을 누르면 그 참가자 선을 따로 강조한다', async () => {
    await render(timelineFixture());

    await act(async () => button('@synthetic-three').click());

    expect(
      container.querySelector('[data-line="s2"].rank-line--pinned'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-line="s2"].rank-line--pinned')
        ?.getAttribute('data-stroke-width'),
    ).toBe('3');
  });

  it('공개 계층에는 합계를 그리지 않는다', async () => {
    await render(
      timelineFixture({
        viewerClass: 'public',
        viewerGithubLogin: null,
        series: [
          { githubLogin: 'synthetic-one', ranks: [2, 1, 1] },
          { githubLogin: 'synthetic-two', ranks: [1, 2, 2] },
        ],
      }),
    );

    await act(async () =>
      chart.onMouseMove?.(
        {},
        {
          clientX: 176,
          clientY: 48,
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          },
        },
      ),
    );

    expect(container.textContent).not.toContain('합계');
  });

  it('달이 없으면 카드를 아예 그리지 않는다', async () => {
    await render(timelineFixture({ points: [], series: [] }));
    expect(container.querySelector('[data-revealed-points]')).toBeNull();
  });

  it('보이지 않는 표로 월별 순위를 늘 제공한다', async () => {
    await render(timelineFixture());

    const rows = Array.from(container.querySelectorAll('table tbody tr')).map(
      (row) =>
        Array.from(row.querySelectorAll('th, td')).map(
          (cell) => cell.textContent ?? '',
        ),
    );
    expect(rows).toEqual([
      ['1월*', '2위', '1위', '—'],
      ['2월*', '1위', '2위', '3위'],
      ['3월', '1위', '2위', '3위'],
    ]);
  });
});

describe('ranking bump chart model', () => {
  it('순위 눈금은 14칸을 넘지 않게 간격을 고른다', () => {
    expect(rankTicks(10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rankTicks(50)).toEqual([1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    expect(rankTicks(300)).toEqual([
      1, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300,
    ]);
    expect(rankTicks(300)).toHaveLength(13);
  });

  it('공개하지 않은 달은 값을 비워 선이 끊기게 만든다', () => {
    const { points, series } = timelineFixture();
    expect(buildRows(points, series, 2)).toEqual([
      { label: '1월*', s0: 2, s1: 1, s2: null },
      { label: '2월*', s0: 1, s1: 2, s2: 3 },
      { label: '3월', s0: null, s1: null, s2: null },
    ]);
  });

  it('두 칸 이상 올라간 사람 중 가장 많이 올라간 사람을 고른다', () => {
    const series = [
      { githubLogin: 'a', ranks: [1, 1] },
      { githubLogin: 'b', ranks: [5, 2] },
      { githubLogin: 'c', ranks: [9, 6] },
      { githubLogin: 'd', ranks: [null, 4] },
    ];
    expect(biggestClimb(series, 2)).toEqual({
      order: 1,
      login: 'b',
      rank: 2,
      climb: 3,
    });
    expect(biggestClimb(series, 1)).toBeNull();
  });

  it('끝 라벨은 14px 간격으로 아래로 밀고 넘치면 버린다', () => {
    const picks = [
      { order: 0, login: 'a', rank: 1 },
      { order: 1, login: 'b', rank: 2 },
      { order: 2, login: 'c', rank: 3 },
    ];
    const placed = stackLabels(picks, null, (rank) => rank * 2, 20);
    expect(placed.map((entry) => entry.y)).toEqual([2, 16]);
  });
});
