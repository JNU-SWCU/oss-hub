import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('recharts', () => ({
  CartesianGrid: () => null,
  Legend: ({ formatter }: { formatter: (value: string) => ReactNode }) => (
    <div data-legend>{formatter('커밋')}</div>
  ),
  Line: ({
    isAnimationActive,
    name,
  }: {
    isAnimationActive: boolean;
    name: string;
  }) => (
    <span
      data-animation-active={String(isAnimationActive)}
      data-series={name}
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
    total: 8,
  },
] as const;

describe('ActivityChart visual stability', () => {
  it('범례 글자를 본문색으로 표시하고 모든 선 애니메이션을 끈다', () => {
    const html = renderToStaticMarkup(<ActivityChart points={points} />);

    expect(html).toContain('<span class="text-foreground">커밋</span>');
    expect(html.match(/data-animation-active="false"/g)).toHaveLength(4);
  });
});
