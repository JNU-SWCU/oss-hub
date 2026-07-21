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

export function ActivityChart({ points }: { points: ActivityPoint[] }) {
  return (
    <div
      role="img"
      aria-label="기간별 커밋, Pull Request, Star, 합계 활동량 선 그래프"
      className="h-80 min-h-80 w-full overflow-hidden"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
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
  );
}
