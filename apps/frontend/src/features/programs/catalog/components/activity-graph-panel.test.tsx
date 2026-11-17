import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../../../../test-support/render-with-query';

import {
  ActivityGraphContent,
  ActivityPanelBody,
} from './activity-graph-panel';
import { getProgramActivity } from '../api';
import type { ProgramActivity } from '../dto';

vi.mock('../api', () => ({ getProgramActivity: vi.fn() }));
vi.mock('recharts', async () => {
  const { createContext, useContext } = await import('react');
  type Row = Readonly<Record<string, unknown>>;
  const Rows = createContext<readonly Row[]>([]);
  return {
    CartesianGrid: () => null,
    LabelList: () => null,
    XAxis: () => null,
    YAxis: () => null,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    BarChart: ({
      children,
      data,
    }: {
      children: ReactNode;
      data: readonly Row[];
    }) => <Rows.Provider value={data}>{children}</Rows.Provider>,
    Bar: ({
      dataKey,
      fill,
      shape,
    }: {
      dataKey: string;
      fill: string;
      shape: (bar: {
        x: number;
        y: number;
        width: number;
        height: number;
        fill: string;
        index: number;
      }) => ReactNode;
    }) => (
      <ol data-bars={dataKey} data-fill={fill}>
        {useContext(Rows).map((row, index) => (
          <li
            key={String(row.teamId)}
            data-team={String(row.teamId)}
            data-value={String(row[dataKey])}
          >
            {shape({ x: 0, y: 0, width: 1, height: 1, fill, index })}
          </li>
        ))}
      </ol>
    ),
    Rectangle: ({ fillOpacity }: { fillOpacity: number }) => (
      <i data-opacity={String(fillOpacity)} />
    ),
  };
});
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function team(
  teamId: string,
  label: string,
  counts: readonly [number, number, number],
  overrides: Partial<ProgramActivity> = {},
): ProgramActivity {
  return {
    teamId,
    label,
    commitCount: counts[0],
    pullRequestCount: counts[1],
    releaseCount: counts[2],
    dataAsOf: '2026-11-17T04:00:00.000Z',
    lastActivityAt: '2026-11-16T12:10:00.000Z',
    collectionStatus: 'READY',
    members: [],
    hasIncompleteContributions: false,
    ...overrides,
  };
}

const TEAM_A = team('a', '팀 A', [40, 2, 0], {
  members: [
    {
      githubLogin: 'alice',
      commitCount: 40,
      pullRequestCount: 2,
      releaseCount: 0,
    },
    {
      githubLogin: 'zero',
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
    },
  ],
});
const TEAM_B = team('b', '팀 B', [20, 4, 1]);

describe('활동 현황 패널', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderBody(
    activities: readonly ProgramActivity[],
    compareTeams = true,
  ): void {
    act(() => {
      root.render(
        <ActivityPanelBody
          state={{ kind: 'ready', activities }}
          onRetry={vi.fn()}
          compareTeams={compareTeams}
        />,
      );
    });
  }

  function charts(): readonly HTMLElement[] {
    return [
      ...container.querySelectorAll<HTMLElement>(
        '[data-slot="activity-chart"]',
      ),
    ];
  }

  function barsOf(chart: HTMLElement) {
    return [...chart.querySelectorAll<HTMLElement>('[data-bars] > li')].map(
      (bar) => ({
        team: bar.dataset.team,
        value: bar.dataset.value,
        opacity: bar.querySelector('i')?.dataset.opacity,
      }),
    );
  }

  function notes(): readonly string[] {
    return [...container.querySelectorAll('[role="note"]')].map(
      (note) => note.textContent ?? '',
    );
  }

  function teamRows(): readonly string[] {
    return [
      ...container.querySelectorAll('ul[aria-label="팀원별 기여"] > li'),
    ].map((row) => row.textContent ?? '');
  }

  function tableRows(scope: ParentNode): readonly (readonly string[])[] {
    return [...scope.querySelectorAll('tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent ?? ''),
    );
  }

  it('불러오는 중, 불러오기 실패, 팀 없음을 서로 다른 상태로 알린다', () => {
    act(() => {
      root.render(
        <ActivityPanelBody state={{ kind: 'loading' }} onRetry={vi.fn()} />,
      );
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      '활동 불러오는 중',
    );

    const onRetry = vi.fn();
    act(() => {
      root.render(
        <ActivityPanelBody state={{ kind: 'failed' }} onRetry={onRetry} />,
      );
    });
    expect(container.textContent).toContain('활동을 불러오지 못했습니다');
    expect(container.textContent).toContain('프로그램 정보는 정상적으로 표시');
    act(() => container.querySelector('button')?.click());
    expect(onRetry).toHaveBeenCalledOnce();

    renderBody([]);
    expect(container.textContent).toContain('표시할 팀이 없습니다');
    expect(charts()).toEqual([]);
  });

  it('지표마다 차트를 하나씩 그리고 팀을 받은 순서대로 놓는다', () => {
    renderBody([TEAM_A, TEAM_B]);

    expect(
      charts().map((chart) => [
        chart.dataset.metric,
        chart.querySelector('p')?.textContent,
        chart.querySelector<HTMLElement>('[data-bars]')?.dataset.fill,
      ]),
    ).toEqual([
      ['commitCount', 'Commit', 'var(--chart-1)'],
      ['pullRequestCount', 'PR', 'var(--chart-2)'],
      ['releaseCount', 'Release', 'var(--chart-3)'],
    ]);
    expect(charts().map((chart) => barsOf(chart))).toEqual([
      [
        { team: 'a', value: '40', opacity: '1' },
        { team: 'b', value: '20', opacity: '1' },
      ],
      [
        { team: 'a', value: '2', opacity: '1' },
        { team: 'b', value: '4', opacity: '1' },
      ],
      [
        { team: 'a', value: '0', opacity: '1' },
        { team: 'b', value: '1', opacity: '1' },
      ],
    ]);
  });

  it('차트를 볼 수 없는 사람에게 같은 수치를 표로 읽어 준다', () => {
    renderBody([TEAM_A, TEAM_B]);

    const chartRegion = charts()[0]?.parentElement;
    expect(chartRegion?.getAttribute('aria-hidden')).toBe('true');
    const table = container.querySelector('.sr-only table');
    if (table === null) throw new TypeError('수치 표를 찾지 못했습니다.');
    expect(table.querySelector('caption')?.textContent).toBe('팀별 활동');
    expect(
      [...table.querySelectorAll('thead th')].map((cell) => cell.textContent),
    ).toEqual(['팀', 'Commit', 'PR', 'Release']);
    expect(tableRows(table)).toEqual([
      ['팀 A', '40', '2', '0'],
      ['팀 B', '20', '4', '1'],
    ]);
  });

  it('모든 팀의 활동이 0이어도 팀마다 0을 그린다', () => {
    renderBody([team('a', '팀 A', [0, 0, 0]), team('b', '팀 B', [0, 0, 0])]);

    expect(charts()).toHaveLength(3);
    for (const chart of charts()) {
      expect(barsOf(chart).map((bar) => bar.value)).toEqual(['0', '0']);
    }
  });

  it('수집에 실패한 팀은 막대를 흐리게 그리고 마지막 수집 시각을 팀 이름과 함께 알린다', () => {
    renderBody([
      TEAM_A,
      team('failed', '리베이스', [64, 9, 1], {
        collectionStatus: 'FAILED',
        dataAsOf: '2026-11-14T00:00:00.000Z',
      }),
    ]);

    expect(barsOf(charts()[0]).map((bar) => bar.opacity)).toEqual(['1', '0.5']);
    expect(notes()).toEqual([
      '리베이스 · 활동 수집에 실패했습니다2026년 11월 14일 09:00에 마지막으로 수집된 값입니다. 잠시 후 다시 확인해 주세요.',
    ]);
  });

  it('한 번도 수집하지 못하고 실패한 팀에는 없는 수집 시각을 지어내지 않는다', () => {
    renderBody([
      team('failed', '리베이스', [0, 0, 0], {
        collectionStatus: 'FAILED',
        dataAsOf: null,
      }),
    ]);

    expect(notes()).toEqual([
      '리베이스 · 활동 수집에 실패했습니다잠시 후 다시 확인해 주세요.',
    ]);
    expect(container.textContent).not.toContain('데이터 기준');
  });

  it('기여도 수집이 온전하지 않은 팀을 팀 이름과 함께 알린다', () => {
    renderBody([
      TEAM_A,
      team('partial', '머지왕', [37, 12, 0], {
        hasIncompleteContributions: true,
      }),
    ]);

    expect(notes()).toEqual([
      '머지왕 · 기여도 수집이 온전하지 않습니다팀원별 합계와 팀 합계가 다릅니다. 수집 당시 팀 명단을 확인하지 못했을 수 있습니다.',
    ]);
  });

  it('저장소가 없거나 아직 수집하지 않은 팀은 차트에서 빼고 사유를 목록에 적는다', () => {
    renderBody([
      TEAM_B,
      team('unlinked', '코드랩', [0, 0, 0], {
        collectionStatus: 'NOT_CONNECTED',
        dataAsOf: null,
      }),
      team('waiting', '새벽커밋', [0, 0, 0], {
        collectionStatus: 'EMPTY',
        dataAsOf: null,
      }),
    ]);

    expect(barsOf(charts()[0]).map((bar) => bar.team)).toEqual(['b']);
    expect(teamRows()).toEqual([
      '코드랩저장소가 연결되지 않았습니다.',
      '새벽커밋아직 수집된 활동이 없습니다.',
    ]);
  });

  it('그릴 팀이 하나도 없으면 차트 없이 사유만 적는다', () => {
    renderBody([
      team('unlinked', '코드랩', [0, 0, 0], {
        collectionStatus: 'NOT_CONNECTED',
        dataAsOf: null,
      }),
    ]);

    expect(charts()).toEqual([]);
    expect(container.querySelector('.sr-only table')).toBeNull();
    expect(teamRows()).toEqual(['코드랩저장소가 연결되지 않았습니다.']);
    expect(container.textContent).not.toContain('데이터 기준');
  });

  it('팀원별 기여는 접힌 채로 시작하고, 누르면 팀원 표를 펼쳤다 다시 접는다', () => {
    renderBody([TEAM_A, TEAM_B]);

    expect(teamRows()).toEqual(['팀 A팀원별 기여 (2명)']);
    const trigger = container.querySelector<HTMLButtonElement>(
      'ul[aria-label="팀원별 기여"] button',
    );
    if (trigger === null)
      throw new TypeError('팀 펼침 버튼을 찾지 못했습니다.');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('@alice');

    act(() => trigger.click());

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const members = container.querySelector(
      '[aria-label="팀 A 팀원별 기여"] table',
    );
    if (members === null) throw new TypeError('팀원 표를 찾지 못했습니다.');
    expect(
      [...members.querySelectorAll('thead th')].map((cell) => cell.textContent),
    ).toEqual(['팀원', 'Commit', 'PR', 'Release']);
    expect(tableRows(members)).toEqual([
      ['@alice', '40', '2', '0'],
      ['@zero', '0', '0', '0'],
    ]);

    act(() => trigger.click());

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('@alice');
  });

  it.each([
    {
      name: '같으면 한 번',
      second: '2026-11-17T04:00:30.000Z',
      caption: '데이터 기준 2026년 11월 17일 13:00',
    },
    {
      name: '다르면 가장 이른 시각부터 범위로',
      second: '2026-11-16T00:00:00.000Z',
      caption: '데이터 기준 2026년 11월 16일 09:00 ~ 2026년 11월 17일 13:00',
    },
  ])('팀마다 수집 시각이 $name 적는다', ({ second, caption }) => {
    renderBody([TEAM_A, { ...TEAM_B, dataAsOf: second }]);

    expect(container.querySelector('div > p:last-child')?.textContent).toBe(
      caption,
    );
  });

  it('우리 팀만 볼 때는 차트 대신 합계와 팀원 표를 팀 이름 없이 보여준다', () => {
    renderBody(
      [
        {
          ...TEAM_A,
          collectionStatus: 'FAILED',
          hasIncompleteContributions: true,
        },
      ],
      false,
    );

    expect(charts()).toEqual([]);
    expect(
      [...container.querySelectorAll('dl > div')].map((item) => [
        item.querySelector('dt')?.textContent,
        item.querySelector('dd')?.textContent,
      ]),
    ).toEqual([
      ['Commit', '40'],
      ['PR', '2'],
      ['Release', '0'],
    ]);
    expect(notes()).toEqual([
      '활동 수집에 실패했습니다2026년 11월 17일 13:00에 마지막으로 수집된 값입니다. 잠시 후 다시 확인해 주세요.',
      '기여도 수집이 온전하지 않습니다팀원별 합계와 팀 합계가 다릅니다. 수집 당시 팀 명단을 확인하지 못했을 수 있습니다.',
    ]);
    expect(container.textContent).toContain('팀원별 기여 (2명)');
    expect(tableRows(container)).toEqual([
      ['@alice', '40', '2', '0'],
      ['@zero', '0', '0', '0'],
    ]);
    expect(container.textContent).not.toContain('팀 A');
  });
});

describe('우리 팀 활동 조회', () => {
  beforeEach(() => notifyManager.setScheduler(queueMicrotask));
  afterEach(() =>
    notifyManager.setScheduler((callback) => setTimeout(callback, 0)),
  );

  it.each(['own-application', 'missing-application'])(
    '우리 팀은 신청 ID %s의 활동만 표시하고 다른 팀으로 대체하지 않는다',
    async (teamId) => {
      vi.mocked(getProgramActivity).mockResolvedValue([
        team('own-application', '우리 팀', [7, 2, 0], { dataAsOf: null }),
        team('other-application', '다른 팀', [999, 2, 0], { dataAsOf: null }),
      ]);
      const view = await renderWithQuery(
        <ActivityGraphContent programId="program" teamId={teamId} />,
      );
      const { container } = view;
      try {
        expect(container.textContent).not.toContain('다른 팀');
        expect(container.textContent).not.toContain('999');
        expect(
          container.querySelector('[data-slot="activity-chart"]'),
        ).toBeNull();
        if (teamId === 'own-application') {
          expect(
            [...container.querySelectorAll('dd')].map(
              (value) => value.textContent,
            ),
          ).toEqual(['7', '2', '0']);
        } else {
          expect(container.querySelector('dd')).toBeNull();
          expect(container.textContent).toContain('우리 팀의 활동이 집계되면');
        }
      } finally {
        await view.unmount();
      }
    },
  );
});
