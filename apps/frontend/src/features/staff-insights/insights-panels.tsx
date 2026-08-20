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
import {
  COHORT_LABELS,
  DEPARTMENT_COHORTS,
  type StaffInsightsCohortRow,
  type StaffInsightsSummary,
} from './types';
import { ACTIVITY_METRICS, COHORT_CHART_KEYS } from './insights-model';

export function ActivityPanel({
  sw,
  nonSw,
}: {
  readonly sw: StaffInsightsCohortRow;
  readonly nonSw: StaffInsightsCohortRow;
}): ReactElement {
  const data = ACTIVITY_METRICS.map((metric) => ({
    metric: metric.label,
    swMajor: sw[metric.field],
    nonSw: nonSw[metric.field],
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>활성 — 랭킹 지표</CardTitle>
        <CardDescription>
          공개 랭킹과 같은 commit · PR · issue · repo · star 합입니다. Star는
          해당 연도가 아니라 계정 전체 누적입니다. 프로그램 신청은 넣지
          않습니다. 학과 미등록은 별도 집계로 공개하며 직접 비교 막대에는 섞지
          않습니다. 막대는 색상 외에도 범례와 좌우 위치로 구분합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-80 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="metric"
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickLine={false}
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
              {COHORT_CHART_KEYS.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  name={series.label}
                  fill={
                    series.key === 'swMajor'
                      ? 'var(--primary)'
                      : 'var(--accent)'
                  }
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>SW전공과 비SW전공의 랭킹 지표</caption>
          <thead>
            <tr>
              <th>지표</th>
              <th>SW전공</th>
              <th>비SW전공</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.metric}>
                <td>{row.metric}</td>
                <td>{row.swMajor}</td>
                <td>{row.nonSw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function DepartmentPanel({
  summary,
}: {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  if (summary.departments.length === 0) {
    return (
      <EmptyState
        title="학과별 학생이 없습니다"
        description="가입을 마친 학생이 생기면 학과 행이 나타납니다."
      />
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>학과별 활성</CardTitle>
        <CardDescription>
          가입 프로필 학과 문자열 기준입니다. 랭킹 합계가 큰 순입니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-xl text-left text-sm">
          <caption className="sr-only">학과별 학생 수와 랭킹 지표</caption>
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-2 pr-3 font-medium">학과</th>
              <th className="py-2 pr-3 font-medium">구분</th>
              <th className="py-2 pr-3 font-medium">학생</th>
              <th className="py-2 pr-3 font-medium">활동</th>
              <th className="py-2 pr-3 font-medium">참여</th>
              {ACTIVITY_METRICS.map((metric) => (
                <th
                  key={metric.field}
                  className={
                    metric.field === 'total'
                      ? 'py-2 font-medium'
                      : 'py-2 pr-3 font-medium'
                  }
                >
                  {metric.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.departments.map((row) => (
              <tr key={row.department} className="border-b last:border-0">
                <td className="py-2 pr-3">{row.department}</td>
                <td className="py-2 pr-3">{COHORT_LABELS[row.cohort]}</td>
                <td className="py-2 pr-3 tabular-nums">{row.studentCount}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {row.activeStudentCount}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {row.participantCount}
                </td>
                {ACTIVITY_METRICS.map((metric) => (
                  <td
                    key={metric.field}
                    className={
                      metric.field === 'total'
                        ? 'py-2 tabular-nums'
                        : 'py-2 pr-3 tabular-nums'
                    }
                  >
                    {row[metric.field]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
