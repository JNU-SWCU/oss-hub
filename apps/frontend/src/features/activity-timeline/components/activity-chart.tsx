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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ActivityPoint } from '../types';

const series = [
  { key: 'commitCount', label: '커밋', color: '#003399' },
  { key: 'prCount', label: 'Pull Request', color: '#00923f' },
  { key: 'releaseCount', label: 'Release', color: '#d97706' },
  { key: 'total', label: '합계', color: '#444444' },
] as const;

export function ActivityChart({
  points,
}: {
  points: readonly ActivityPoint[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
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
            <Legend
              formatter={(value: string) => (
                <span className="text-foreground">{value}</span>
              )}
              wrapperStyle={{ fontSize: 12 }}
            />
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
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="rounded-md border border-border">
        <Table>
          <TableCaption className="sr-only">기간별 활동량</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">기간</TableHead>
              <TableHead scope="col" className="text-right">
                커밋
              </TableHead>
              <TableHead scope="col" className="text-right">
                Pull Request
              </TableHead>
              <TableHead scope="col" className="text-right">
                Release
              </TableHead>
              <TableHead scope="col" className="text-right">
                합계
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((point) => (
              <TableRow key={point.period}>
                <TableHead scope="row">{point.period}</TableHead>
                <TableCell className="text-right">
                  {point.commitCount}
                </TableCell>
                <TableCell className="text-right">{point.prCount}</TableCell>
                <TableCell className="text-right">
                  {point.releaseCount}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {point.total}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
