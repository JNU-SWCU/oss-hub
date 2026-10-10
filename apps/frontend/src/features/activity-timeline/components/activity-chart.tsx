'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DataTable, type DataTableColumn } from '@/components';
import { orderActivityPoints } from '../activity-point-order';
import type { ActivityPoint } from '../types';

const series = [
  { key: 'commitCount', label: 'Commit', color: 'var(--chart-1)' },
  { key: 'prCount', label: 'Pull Request', color: 'var(--chart-2)' },
  { key: 'releaseCount', label: 'Release', color: 'var(--chart-3)' },
  { key: 'issueCount', label: 'Issue', color: 'var(--chart-4)' },
  { key: 'total', label: '합계', color: 'var(--foreground)' },
] as const;

const NUMBER_COLUMN = {
  headClassName: 'text-right',
  cellClassName: 'text-right',
} as const;

const TABLE_COLUMNS: DataTableColumn<ActivityPoint>[] = [
  {
    id: 'period',
    header: '기간',
    cell: (point) => point.period,
    rowHeader: true,
  },
  {
    id: 'commitCount',
    header: 'Commit',
    cell: (point) => point.commitCount,
    ...NUMBER_COLUMN,
  },
  {
    id: 'prCount',
    header: 'Pull Request',
    cell: (point) => point.prCount,
    ...NUMBER_COLUMN,
  },
  {
    id: 'releaseCount',
    header: 'Release',
    cell: (point) => point.releaseCount,
    ...NUMBER_COLUMN,
  },
  {
    id: 'issueCount',
    header: 'Issue',
    cell: (point) => point.issueCount,
    ...NUMBER_COLUMN,
  },
  {
    id: 'total',
    header: '합계',
    cell: (point) => point.total,
    headClassName: 'text-right',
    cellClassName: 'text-right font-medium',
  },
];

export function hasIssueCounts(points: readonly ActivityPoint[]): boolean {
  return points.some((point) => point.issueCount !== null);
}

export function ActivityChart({
  points,
}: {
  points: readonly ActivityPoint[];
}) {
  const orderedPoints = orderActivityPoints(points);
  const showIssues = hasIssueCounts(points);
  const visibleSeries = showIssues
    ? series
    : series.filter((item) => item.key !== 'issueCount');
  const columns = showIssues
    ? TABLE_COLUMNS
    : TABLE_COLUMNS.filter((column) => column.id !== 'issueCount');

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div aria-hidden="true" className="h-80 min-h-80 w-full overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={orderedPoints.chart}
            margin={{ top: 12, right: 12, left: -12, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="period"
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
            />
            <YAxis
              allowDecimals={false}
              width={44}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                borderColor: 'var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--background)',
              }}
            />
            <Legend
              itemSorter={(item) =>
                series.findIndex((entry) => entry.key === item.dataKey)
              }
              formatter={(value: string) => (
                <span className="text-foreground">{value}</span>
              )}
              wrapperStyle={{ fontSize: 12, left: 0 }}
            />
            {visibleSeries.map((item) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.label}
                stroke={item.color}
                strokeWidth={item.key === 'total' ? 3 : 2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        columns={columns}
        data={[...orderedPoints.table]}
        rowKey={(point) => point.period}
        caption="기간별 활동량"
        hideCaption
        scrollRegionLabel="기간별 활동량 표"
        className="rounded-md border border-border"
      />
    </div>
  );
}
