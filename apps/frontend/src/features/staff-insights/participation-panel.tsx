import type { ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '@/components';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COHORT_LABELS, DEPARTMENT_COHORTS } from './types';
import type { StaffInsightsSummary } from './types';

interface ProgramNameTickProps {
  readonly x?: number;
  readonly y?: number;
  readonly payload?: { readonly value: string };
}

function ProgramNameTick({
  x = 0,
  y = 0,
  payload,
}: ProgramNameTickProps): ReactElement | null {
  if (payload === undefined) return null;
  const label =
    payload.value.length > 14
      ? `${payload.value.slice(0, 13)}…`
      : payload.value;
  return (
    <text
      className="recharts-text recharts-cartesian-axis-tick-value"
      x={x - 8}
      y={y}
      dy="0.355em"
      textAnchor="end"
      fill="var(--muted-foreground)"
      fontSize={12}
    >
      <title>{payload.value}</title>
      {label}
    </text>
  );
}

export function ParticipationPanel({
  summary,
}: {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  if (summary.programs.length === 0) {
    return (
      <EmptyState
        title="승인된 참여가 없습니다"
        description="프로그램 신청이 승인되면 여기서 전공·비전공 참여를 비교합니다."
      />
    );
  }
  const data = summary.programs.map((program) => ({
    name: program.name,
    swMajor: program.swMajorCount,
    nonSw: program.nonSwCount,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>참여 — 프로그램별</CardTitle>
        <CardDescription>
          승인된 신청의 신청자와 그 팀 멤버를 unique로 셉니다. 랭킹 합계와는
          다른 축입니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="w-full"
          style={{ height: Math.max(320, data.length * 52) }}
          aria-hidden="true"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={168}
                tick={<ProgramNameTick />}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="swMajor"
                name={COHORT_LABELS[DEPARTMENT_COHORTS.SW_MAJOR]}
                fill="var(--primary)"
              />
              <Bar
                dataKey="nonSw"
                name={COHORT_LABELS[DEPARTMENT_COHORTS.NON_SW]}
                fill="var(--accent)"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>프로그램별 SW전공과 비SW전공 참여자</caption>
          <thead>
            <tr>
              <th>프로그램</th>
              <th>SW전공</th>
              <th>비SW전공</th>
              <th>미등록</th>
            </tr>
          </thead>
          <tbody>
            {summary.programs.map((program) => (
              <tr key={program.programId}>
                <td>{program.name}</td>
                <td>{program.swMajorCount}</td>
                <td>{program.nonSwCount}</td>
                <td>{program.unregisteredCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
