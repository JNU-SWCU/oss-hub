import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankingTimeline, RankingTimelineSeries } from '../types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('./comic-font', () => ({ comicNeue: { variable: 'font-comic' } }));

vi.mock('recharts', () => {
  const Plot = ({ children }: { readonly children: ReactNode }) => (
    <svg data-chart="">{children}</svg>
  );
  return {
    ResponsiveContainer: ({ children }: { readonly children: ReactNode }) => (
      <div>{children}</div>
    ),
    LineChart: Plot,
    ComposedChart: Plot,
    XAxis: () => null,
    YAxis: () => null,
    ZIndexLayer: ({ children }: { readonly children: ReactNode }) => (
      <g data-layer="">{children}</g>
    ),
    Area: ({
      dataKey,
      'data-band': band,
      'data-band-label': bandLabel,
      'data-envelope': envelope,
    }: {
      readonly dataKey: string;
      readonly 'data-band'?: number;
      readonly 'data-band-label'?: string;
      readonly 'data-envelope'?: string;
    }) => (
      <g
        data-area={dataKey}
        {...(band === undefined ? {} : { 'data-band': band })}
        {...(bandLabel === undefined ? {} : { 'data-band-label': bandLabel })}
        {...(envelope === undefined ? {} : { 'data-envelope': envelope })}
      />
    ),
    Line: ({
      dataKey,
      strokeWidth,
      'data-viewer-line': viewerLine,
      'data-growth-viewer-line': growthLine,
    }: {
      readonly dataKey: string;
      readonly strokeWidth?: number;
      readonly 'data-viewer-line'?: string;
      readonly 'data-growth-viewer-line'?: string;
    }) => (
      <g
        data-line={dataKey}
        data-stroke-width={strokeWidth}
        {...(viewerLine === undefined
          ? {}
          : { 'data-viewer-line': viewerLine })}
        {...(growthLine === undefined
          ? {}
          : { 'data-growth-viewer-line': growthLine })}
      />
    ),
    usePlotArea: () => ({ x: 56, y: 28, width: 800, height: 300 }),
    useXAxisScale: () => (value: unknown) =>
      typeof value === 'string'
        ? 56 + 60 * Number(value.replace(/\D/gu, ''))
        : undefined,
    useYAxisScale: () => (value: unknown) =>
      typeof value === 'number' ? 328 - Math.min(value, 420) * 0.7 : undefined,
    useXAxisTicks: () => [{ coordinate: 100 }],
    useYAxisTicks: () => [{ coordinate: 50 }],
  };
});

import { RankingChartTabs } from './ranking-chart-tabs';

const POINTS = [
  '2026-01-31',
  '2026-02-28',
  '2026-03-31',
  '2026-04-19',
] as const;

const RIVALS: readonly (readonly number[])[] = [
  [10, 20, 30, 40],
  [20, 40, 60, 80],
  [30, 60, 90, 120],
  [40, 80, 120, 160],
  [50, 100, 150, 200],
];

function rivals(): RankingTimelineSeries[] {
  return RIVALS.map((totals, index) => ({
    githubLogin: `rival-${String(index + 1)}`,
    ranks: totals.map(() => index + 2),
    totals,
  }));
}

function viewerSeries(
  totals: readonly (number | null)[],
  ranks: readonly (number | null)[] = [6, 4, 3, 1],
): RankingTimelineSeries {
  return { githubLogin: 'me', ranks, totals };
}

function timelineOf(overrides: Partial<RankingTimeline> = {}): RankingTimeline {
  return {
    year: 2026,
    viewerClass: 'member',
    viewerGithubLogin: 'me',
    dataAsOf: new Date('2026-04-19T02:30:00.000Z'),
    points: POINTS.map((date, index) => ({
      date,
      starEstimated: index < POINTS.length - 1,
    })),
    series: [viewerSeries([1, 50, 130, 210]), ...rivals()],
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

describe('RankingChartTabs', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    stubMotionPreference(false);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(timeline: RankingTimeline) {
    await act(async () =>
      root.render(<RankingChartTabs timeline={timeline} />),
    );
  }
  function shell(): HTMLElement {
    const found = container.querySelector<HTMLElement>('[data-active-tab]');
    if (!found) throw new Error('shell root missing');
    return found;
  }
  function tab(name: string): HTMLButtonElement {
    const found = container.querySelector<HTMLButtonElement>(
      `[data-tab="${name}"]`,
    );
    if (!found) throw new Error(`tab missing: ${name}`);
    return found;
  }
  function panel(name: string): HTMLElement {
    const found = container.querySelector<HTMLElement>(
      `[data-tab-panel="${name}"]`,
    );
    if (!found) throw new Error(`panel missing: ${name}`);
    return found;
  }
  async function press(key: string) {
    const tablist = container.querySelector('[role="tablist"]');
    if (!tablist) throw new Error('tablist missing');
    await act(async () => {
      tablist.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
      );
    });
  }

  it('회원은 내 성장 탭에서 시작하고 탭 세 개를 준다', async () => {
    await render(timelineOf());

    expect(shell().getAttribute('data-active-tab')).toBe('growth');
    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    expect(tabs.map((node) => node.textContent)).toEqual([
      '내 성장',
      '이번 달',
      '순위 레이스',
    ]);
    expect(tabs.map((node) => node.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(tabs.map((node) => node.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
    ]);
    expect(
      container.querySelector('[role="tablist"]')?.getAttribute('aria-label'),
    ).toBe('랭킹 그래프 보기');
  });

  it('처음에는 활성 패널만 그리고 나머지는 숨긴 채 비워 둔다', async () => {
    await render(timelineOf());

    expect(panel('growth').hidden).toBe(false);
    expect(panel('month').hidden).toBe(true);
    expect(panel('race').hidden).toBe(true);
    expect(panel('month').childElementCount).toBe(0);
    expect(panel('race').childElementCount).toBe(0);
    expect(panel('growth').getAttribute('role')).toBe('tabpanel');
  });

  it('탭을 한 번 열면 그 뒤로는 계속 살려 둔다', async () => {
    await render(timelineOf());

    await act(async () => tab('month').click());
    expect(shell().getAttribute('data-active-tab')).toBe('month');
    expect(panel('month').childElementCount).toBeGreaterThan(0);
    expect(panel('race').childElementCount).toBe(0);

    await act(async () => tab('growth').click());
    expect(panel('month').hidden).toBe(true);
    expect(panel('month').childElementCount).toBeGreaterThan(0);
  });

  it('화살표와 Home·End로 탭을 넘긴다', async () => {
    await render(timelineOf());

    await press('ArrowRight');
    expect(shell().getAttribute('data-active-tab')).toBe('month');
    expect(document.activeElement).toBe(tab('month'));

    await press('ArrowRight');
    expect(shell().getAttribute('data-active-tab')).toBe('race');

    await press('ArrowRight');
    expect(shell().getAttribute('data-active-tab')).toBe('growth');

    await press('ArrowLeft');
    expect(shell().getAttribute('data-active-tab')).toBe('race');
    expect(document.activeElement).toBe(tab('race'));

    await press('Home');
    expect(shell().getAttribute('data-active-tab')).toBe('growth');

    await press('End');
    expect(shell().getAttribute('data-active-tab')).toBe('race');
  });

  it('비로그인 뷰어에게는 탭 없이 순위 레이스만 준다', async () => {
    await render(
      timelineOf({
        viewerClass: 'public',
        viewerGithubLogin: null,
        series: [
          { githubLogin: 'rival-1', ranks: [1, 1, 1, 1] },
          { githubLogin: 'rival-2', ranks: [2, 2, 2, 2] },
        ],
      }),
    );

    expect(shell().getAttribute('data-active-tab')).toBe('race');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelectorAll('[data-tab]')).toHaveLength(0);
    expect(container.querySelector('[data-revealed-points]')).not.toBeNull();
    expect(container.querySelector('[data-this-month]')).toBeNull();
    expect(container.querySelector('[data-podium-rank]')).toBeNull();
    expect(container.querySelector('[data-band]')).toBeNull();
    expect(container.textContent).not.toContain('이번 달');
  });

  it('참가자가 아닌 운영자는 이번 달 탭에서 시작한다', async () => {
    await render(
      timelineOf({
        viewerClass: 'staff',
        viewerGithubLogin: 'staff-only',
        series: rivals(),
      }),
    );

    expect(shell().getAttribute('data-active-tab')).toBe('month');
    expect(panel('month').hidden).toBe(false);
    expect(container.querySelector('[data-nudge]')).toBeNull();
    expect(container.querySelector('[data-month-bar]')).toBeNull();
  });

  it('그릴 참가자가 없으면 빈 연습장을 친절하게 보여준다', async () => {
    await render(timelineOf({ series: [] }));

    expect(container.querySelector('[data-chart-empty]')).not.toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).toContain('아직 그릴 활동이 없어요');
  });

  it('달이 없으면 카드를 아예 그리지 않는다', async () => {
    await render(timelineOf({ points: [], series: [] }));

    expect(container.querySelector('[data-active-tab]')).toBeNull();
  });

  it('내 성장 탭은 다섯 구간과 올라온 자리마다 스티커를 남긴다', async () => {
    await render(timelineOf());

    expect(container.querySelectorAll('[data-band]')).toHaveLength(5);
    expect(
      Array.from(container.querySelectorAll('[data-band-label]')).map((node) =>
        node.getAttribute('data-band-label'),
      ),
    ).toEqual(['베이스캠프', '숲길', '바위 능선', '설원', '정상 공기']);
    expect(
      Array.from(container.querySelectorAll('[data-band-crossing]')).map(
        (node) => node.getAttribute('data-band-crossing'),
      ),
    ).toEqual(['1:1', '2:2', '3:2', '4:3']);
    expect(container.querySelector('[data-fresh]')).not.toBeNull();
    expect(container.textContent).toContain('정상 공기 진입!');
    expect(container.querySelector('[data-growth-endlabel]')?.textContent).toBe(
      '@me1위 ▲2',
    );
    expect(
      shell()
        .querySelector('[data-this-month]')
        ?.getAttribute('data-this-month'),
    ).toBe('80');
    expect(container.querySelector('[data-growth-viewer-line]')).not.toBeNull();
  });

  it('참가자가 적으면 구간 대신 전원 범위를 그린다', async () => {
    await render(
      timelineOf({
        series: [viewerSeries([1, 5, 9, 12]), ...rivals().slice(0, 2)],
      }),
    );

    expect(container.querySelector('[data-envelope]')).not.toBeNull();
    expect(container.querySelectorAll('[data-band]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-band-crossing]')).toHaveLength(0);
    expect(container.textContent).toContain('참가 전원 범위 (3명)');
  });

  it('혼자면 구간 없이 솔로 등반으로 적는다', async () => {
    await render(timelineOf({ series: [viewerSeries([1, 5, 9, 12])] }));

    expect(container.querySelector('[data-solo]')).not.toBeNull();
    expect(container.querySelectorAll('[data-band]')).toHaveLength(0);
    expect(container.textContent).toContain('아직 비교할 친구가 없어요');
  });

  it('올해 0점이면 출발선 안내를 먼저 보여준다', async () => {
    await render(
      timelineOf({
        series: [viewerSeries([0, 0, 0, 0], [6, 6, 6, 6]), ...rivals()],
      }),
    );

    expect(
      container
        .querySelector('[data-this-month]')
        ?.getAttribute('data-this-month'),
    ).toBe('0');
    expect(container.textContent).toContain('아직 올해 점수가 없어요');

    await act(async () => tab('month').click());
    expect(
      container.querySelector('[data-rank-row-viewer]')?.textContent,
    ).toContain('나 · @me');
    expect(container.textContent).toContain('1점이면 바로 출발');
  });

  it('이번 달 탭은 시상대와 내 자리, 다음 칸까지의 점수를 적는다', async () => {
    await render(timelineOf());
    await act(async () => tab('month').click());

    expect(
      Array.from(container.querySelectorAll('[data-podium-rank]')).map((node) =>
        node.getAttribute('data-podium-rank'),
      ),
    ).toEqual(['2', '1', '3']);
    expect(container.querySelector('[data-podium-viewer]')).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll('[data-rank-row]')).map((node) =>
        node.getAttribute('data-rank-row'),
      ),
    ).toEqual(['4', '5', '6']);
    expect(container.textContent).toContain('선두! 2위와 30점 차');
    expect(container.querySelectorAll('[data-month-bar]')).toHaveLength(4);
    expect(container.querySelector('[data-month-bar-max]')).not.toBeNull();
    expect(container.textContent).toContain('참가 6명');
  });

  it('시상대 로그인은 가운데를 접고 꼬리와 전체 이름을 남긴다', async () => {
    await render(
      timelineOf({
        series: [
          viewerSeries([1, 50, 130, 210]),
          ...rivals().map((series, index) =>
            index === 3 ? { ...series, totals: [40, 80, 120, 170] } : series,
          ),
        ],
      }),
    );
    await act(async () => tab('month').click());

    const login = container.querySelector<HTMLElement>(
      '[data-podium-rank="2"] [data-podium-login]',
    );
    const parts = Array.from(
      login?.querySelectorAll<HTMLElement>('[aria-hidden="true"]') ?? [],
    ).map((node) => node.textContent ?? '');
    expect(login?.title).toBe('@rival-5 외 1명');
    expect(parts.join('')).toBe(login?.title);
    expect(parts[1]).toBe('al-5 외 1명');
    expect(login?.querySelector('.sr-only')?.textContent).toBe(login?.title);
  });

  it('중간 순위면 한 칸 위까지 몇 점인지 넛지한다', async () => {
    await render(
      timelineOf({
        series: [viewerSeries([0, 0, 0, 25]), ...rivals()],
      }),
    );
    await act(async () => tab('month').click());

    expect(
      container.querySelector('[data-nudge]')?.getAttribute('data-nudge'),
    ).toBe('5');
    expect(container.textContent).toContain(
      '5점 더 하면 한 칸 위 — @rival-3와 5점 차',
    );
    expect(container.querySelector('[data-podium-viewer]')).toBeNull();
    expect(
      container
        .querySelector('[data-rank-row-viewer]')
        ?.getAttribute('data-rank-row'),
    ).toBe('4');
  });

  it('모두 0점인 달은 출발선 그림으로 바꾼다', async () => {
    await render(
      timelineOf({
        series: [
          viewerSeries([10, 20, 30, 30]),
          ...RIVALS.map((totals, index) => ({
            githubLogin: `rival-${String(index + 1)}`,
            ranks: totals.map(() => index + 2),
            totals: [totals[0] ?? 0, totals[1] ?? 0, 9, 9],
          })),
        ],
      }),
    );
    await act(async () => tab('month').click());

    expect(container.querySelector('[data-startline]')).not.toBeNull();
    expect(container.querySelectorAll('[data-podium-rank]')).toHaveLength(0);
    expect(container.textContent).toContain('새 달 출발선입니다');
  });

  it('자체 신기록과 컴백을 트리거가 있을 때만 붙인다', async () => {
    await render(
      timelineOf({ series: [viewerSeries([2, 4, 4, 40]), ...rivals()] }),
    );
    await act(async () => tab('month').click());

    expect(container.querySelector('[data-personal-best]')).not.toBeNull();
    expect(container.querySelector('[data-comeback]')).not.toBeNull();
    expect(container.textContent).toContain('올해 최고 기록!');
  });

  it('순위 레이스 탭은 기존 범프 차트를 그대로 품는다', async () => {
    await render(timelineOf());
    await act(async () => tab('race').click());

    const race = panel('race');
    expect(race.querySelector('[data-revealed-points]')).not.toBeNull();
    expect(race.querySelectorAll('[data-viewer-line]')).toHaveLength(1);
    expect(race.querySelector('[data-org-membership-hint]')).not.toBeNull();
    expect(race.querySelector('[data-star-estimated-note]')).not.toBeNull();
  });
});
