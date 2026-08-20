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
        <div className="h-80 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, left: -12, bottom: 24 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="name"
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickLine={false}
                interval={0}
              />
              <YAxis
                allowDecimals={false}
                width={44}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
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
