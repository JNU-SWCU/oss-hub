import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('recharts', () => ({
  CartesianGrid: () => null,
  Legend: ({
    formatter,
    itemSorter,
  }: {
    formatter: (value: string) => ReactNode;
    itemSorter: (item: { value: string; dataKey: string }) => number;
  }) => (
    <div data-legend>
      {[
        { value: 'Commit', dataKey: 'commitCount' },
        { value: 'Issue', dataKey: 'issueCount' },
        { value: 'Pull Request', dataKey: 'prCount' },
        { value: 'Release', dataKey: 'releaseCount' },
        { value: '합계', dataKey: 'total' },
      ]
        .sort((left, right) => itemSorter(left) - itemSorter(right))
        .map((item) => (
          <span key={item.dataKey} data-legend-item={item.value}>
            {formatter(item.value)}
          </span>
        ))}
    </div>
  ),
  Line: ({
    isAnimationActive,
    name,
    stroke,
  }: {
    isAnimationActive: boolean;
    name: string;
    stroke: string;
  }) => (
    <span
      data-animation-active={String(isAnimationActive)}
      data-series={name}
      data-stroke={stroke}
    />
  ),
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { ActivityChart } from './activity-chart';

const points = [
  {
    period: '2026-07',
    commitCount: 5,
    prCount: 2,
    releaseCount: 1,
    issueCount: 3,
    total: 8,
  },
] as const;

describe('ActivityChart visual stability', () => {
  it('범례 글자를 본문색으로 표시하고 모든 선 애니메이션을 끈다', () => {
    const html = renderToStaticMarkup(<ActivityChart points={points} />);

    expect(html).toContain('<span class="text-foreground">Commit</span>');
    expect(html.match(/data-animation-active="false"/g)).toHaveLength(5);
  });

  it('범례를 표와 같은 계열 순서로 보인다', () => {
    const html = renderToStaticMarkup(<ActivityChart points={points} />);

    expect(
      [...html.matchAll(/data-legend-item="([^"]+)"/g)].map(([, name]) => name),
    ).toEqual(['Commit', 'Pull Request', 'Release', 'Issue', '합계']);
  });

  it('Issue 선을 기존 차트 토큰으로 합계 앞에 그린다', () => {
    const html = renderToStaticMarkup(<ActivityChart points={points} />);

    expect(
      [...html.matchAll(/data-series="([^"]+)" data-stroke="([^"]+)"/g)].map(
        ([, name, stroke]) => [name, stroke],
      ),
    ).toEqual([
      ['Commit', 'var(--chart-1)'],
      ['Pull Request', 'var(--chart-2)'],
      ['Release', 'var(--chart-3)'],
      ['Issue', 'var(--chart-4)'],
      ['합계', 'var(--foreground)'],
    ]);
  });
});
