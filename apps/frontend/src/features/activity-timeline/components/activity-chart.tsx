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
import type { ActivityPoint } from '../types';

const series = [
  { key: 'commitCount', label: '커밋', color: '#003399' },
  { key: 'prCount', label: 'Pull Request', color: '#00923f' },
  { key: 'starCount', label: 'Star', color: '#d97706' },
  { key: 'total', label: '합계', color: '#444444' },
] as const;

export function ActivityChart({
  points,
}: {
  points: readonly ActivityPoint[];
}) {
  return (
    <>
      <table className="sr-only">
        <caption>기간별 활동량</caption>
        <thead>
          <tr>
            <th scope="col">기간</th>
            <th scope="col">커밋</th>
            <th scope="col">Pull Request</th>
            <th scope="col">Star</th>
            <th scope="col">합계</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.period}>
              <th scope="row">{point.period}</th>
              <td>{point.commitCount}</td>
              <td>{point.prCount}</td>
              <td>{point.starCount}</td>
              <td>{point.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div aria-hidden="true" className="h-80 min-h-80 w-full overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={[...points]}
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
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((item) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.label}
                stroke={item.color}
                strokeWidth={item.key === 'total' ? 3 : 2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
