// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamActivity, TeamActivityMember } from './team-activity-api';
import { TeamActivityGraph } from './team-activity-graph';

/** recharts는 크기를 재야 그린다. 선·기준선만 남겨 이 화면이 무엇을 넘기는지 본다. */
const chart = vi.hoisted(() => ({
  onMouseMove: undefined as
    undefined | ((state: { readonly activeTooltipIndex?: unknown }) => void),
}));
vi.mock('recharts', () => ({
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({
    children,
    onMouseMove,
  }: {
    children: ReactNode;
    onMouseMove: typeof chart.onMouseMove;
  }) => {
    chart.onMouseMove = onMouseMove;
    return <div data-chart="">{children}</div>;
  },
  ReferenceLine: ({ x }: { x: string }) => <span data-reference-week={x} />,
  Line: ({
    dataKey,
    stroke,
    strokeDasharray,
  }: {
    dataKey: string;
    stroke: string;
    strokeDasharray?: string;
  }) => (
    <span
      data-line={dataKey}
      data-stroke={stroke}
      data-dashed={String(strokeDasharray !== undefined)}
    />
  ),
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function member(
  login: string,
  points: readonly {
    readonly date: string;
    readonly commitCount?: number;
    readonly pullRequestCount?: number;
  }[],
): TeamActivityMember {
  const filled = points.map((point) => ({
    date: point.date,
    commitCount: point.commitCount ?? 0,
    pullRequestCount: point.pullRequestCount ?? 0,
    issueCount: 0,
  }));
  return {
    userId: `user-${login}`,
    githubLogin: login,
    totals: {
      commitCount: filled.reduce((sum, point) => sum + point.commitCount, 0),
      pullRequestCount: filled.reduce(
        (sum, point) => sum + point.pullRequestCount,
        0,
      ),
      issueCount: 0,
    },
    points: filled,
  };
}

/** 끝난 프로그램의 두 주 — 오늘과 무관하게 `2026-08-03`·`2026-08-10` 두 주가 된다. */
const collected: TeamActivity = {
  applicationId: 'application-1',
  repository: { id: 'repo-1', url: 'https://github.com/synthetic/team' },
  status: 'COLLECTED',
  lastSuccessAt: '2026-08-17T01:00:00.000Z',
  window: { from: '2026-08-03', to: '2026-08-16', timeZone: 'Asia/Seoul' },
  canEditRepositoryUrl: true,
  members: [
    member('ada', [
      { date: '2026-08-04', commitCount: 3, pullRequestCount: 1 },
      { date: '2026-08-11', commitCount: 2 },
    ]),
    member('bob', [{ date: '2026-08-12', commitCount: 5 }]),
    member('cy', []),
  ],
};

describe('TeamActivityGraph', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    chart.onMouseMove = undefined;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  async function render(activity: TeamActivity) {
    await act(async () =>
      root.render(
        <TeamActivityGraph activity={activity} label="우리 팀 활동" />,
      ),
    );
  }
  function group(): HTMLElement {
    const found = container.querySelector<HTMLElement>(
      '[data-slot="team-activity-chart"]',
    );
    if (!found) throw new Error('chart group missing');
    return found;
  }
  function readout(): string | null {
    return (
      container.querySelector('[data-slot="team-activity-readout"]')
        ?.textContent ?? null
    );
  }
  function tableRows(): string[][] {
    return Array.from(container.querySelectorAll('table tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('th, td')).map(
        (cell) => cell.textContent ?? '',
      ),
    );
  }
  function chip(label: string): HTMLButtonElement {
    const found = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent === label);
    if (!found) throw new Error(`chip missing: ${label}`);
    return found;
  }

  it('저장소가 없으면 그래프 대신 연결 안내만 둔다', async () => {
    await render({ ...collected, status: 'NOT_CONNECTED', repository: null });
    expect(container.textContent).toContain('아직 연결한 저장소가 없습니다');
    expect(container.querySelector('[data-chart]')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('아직 모으지 않았으면 0을 그리지 않고 기다린다고 말한다', async () => {
    await render({
      ...collected,
      status: 'NOT_COLLECTED',
      lastSuccessAt: null,
    });
    expect(container.textContent).toContain('첫 수집을 기다리는 중입니다');
    expect(container.querySelector('[data-chart]')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('수집 실패는 마지막 성공 시각과 함께 그때까지의 그래프를 흐리게 둔다', async () => {
    await render({ ...collected, status: 'ERROR' });
    expect(container.textContent).toContain('최근 수집에 실패했습니다');
    expect(container.textContent).toContain(
      '마지막 수집 2026년 8월 17일 10:00',
    );
    expect(container.querySelector('[data-chart]')).not.toBeNull();
    expect(
      container.querySelector('[data-slot="team-activity-plot"]')?.className,
    ).toContain('opacity-60');
    expect(
      container.querySelector('[data-slot="filter-chip-group"]')?.className,
    ).not.toContain('opacity-60');
  });

  it('한 번도 모으지 못한 실패는 그래프를 그리지 않는다', async () => {
    await render({ ...collected, status: 'ERROR', lastSuccessAt: null });
    expect(container.textContent).toContain('최근 수집에 실패했습니다');
    expect(container.querySelector('[data-chart]')).toBeNull();
  });

  it('기여한 팀원만 선을 긋고, 기여 없는 팀원도 범례에서 빠지지 않는다', async () => {
    await render(collected);
    expect(
      Array.from(container.querySelectorAll('[data-line]')).map((line) =>
        line.getAttribute('data-stroke'),
      ),
    ).toEqual(['var(--chart-1)', 'var(--chart-2)']);
    const legend = container.querySelector('ul[aria-label="팀원"]');
    expect(legend?.querySelectorAll('li')).toHaveLength(3);
    expect(legend?.textContent).toContain('@cy이 기간 기여 없음');
    expect(legend?.textContent).not.toContain('@ada이 기간 기여 없음');
  });

  it('여섯 번째 팀원부터는 색을 돌려 쓰고 점선으로 가른다', async () => {
    await render({
      ...collected,
      members: ['a', 'b', 'c', 'd', 'e', 'f'].map((login) =>
        member(login, [{ date: '2026-08-04', commitCount: 1 }]),
      ),
    });
    const lines = Array.from(container.querySelectorAll('[data-line]'));
    expect(lines.map((line) => line.getAttribute('data-dashed'))).toEqual([
      'false',
      'false',
      'false',
      'false',
      'false',
      'true',
    ]);
    expect(lines[5]?.getAttribute('data-stroke')).toBe('var(--chart-1)');
  });

  it('숫자는 보이지 않는 표로만 늘 있고, 칩을 바꾸면 그 지표로 바뀐다', async () => {
    await render(collected);
    expect(chip('Commit').getAttribute('aria-pressed')).toBe('true');
    expect(tableRows()).toEqual([
      ['2026.08.03 주', '3', '0', '0', '3'],
      ['2026.08.10 주', '2', '5', '0', '7'],
    ]);
    expect(readout()).toBeNull();

    await act(async () => chip('PR').click());

    expect(chip('PR').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Commit').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('caption')?.textContent).toBe(
      '우리 팀 활동 — 주별 PR',
    );
    expect(tableRows()).toEqual([
      ['2026.08.03 주', '1', '0', '0', '1'],
      ['2026.08.10 주', '0', '0', '0', '0'],
    ]);
  });

  it('가리킬 때만 그 주의 팀원별 값과 팀 합계를 보이고 벗어나면 감춘다', async () => {
    await render(collected);
    await act(async () => chart.onMouseMove?.({ activeTooltipIndex: '1' }));

    expect(readout()).toContain('2026.08.10 주 · Commit');
    expect(readout()).toContain('@ada2');
    expect(readout()).toContain('@bob5');
    expect(readout()).toContain('팀 합계7');
    expect(
      container
        .querySelector('[data-reference-week]')
        ?.getAttribute('data-reference-week'),
    ).toBe('2026-08-10');

    await act(async () => {
      group().dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(readout()).toBeNull();
    expect(container.querySelector('[data-reference-week]')).toBeNull();
  });

  it('초점을 받으면 최근 주부터 말하고 화살표로 주를 옮긴다', async () => {
    await render(collected);
    const chartGroup = group();
    expect(chartGroup.tabIndex).toBe(0);

    await act(async () => chartGroup.focus());
    expect(readout()).toContain('2026.08.10 주');
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      '2026.08.10 주 Commit: @ada 2, @bob 5, @cy 0, 팀 합계 7',
    );

    await act(async () => {
      chartGroup.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
    });
    expect(readout()).toContain('2026.08.03 주');
    expect(readout()).toContain('팀 합계3');

    // 첫 주에서 더 왼쪽은 없다.
    await act(async () => {
      chartGroup.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
    });
    expect(readout()).toContain('2026.08.03 주');

    await act(async () => {
      chartGroup.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(readout()).toContain('2026.08.10 주');

    await act(async () => chartGroup.blur());
    expect(readout()).toBeNull();
  });
});
