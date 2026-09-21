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
import { DataTable, EmptyState, type DataTableColumn } from '@/components';
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
  type StaffInsightsDepartmentRow,
  type StaffInsightsSummary,
} from './types';
import { ACTIVITY_METRICS, COHORT_CHART_KEYS } from './insights-model';

const DEPARTMENT_COLUMNS: DataTableColumn<StaffInsightsDepartmentRow>[] = [
  { id: 'department', header: '학과', cell: (row) => row.department },
  { id: 'cohort', header: '구분', cell: (row) => COHORT_LABELS[row.cohort] },
  {
    id: 'studentCount',
    header: '학생',
    cell: (row) => row.studentCount,
    cellClassName: 'tabular-nums',
  },
  {
    id: 'activeStudentCount',
    header: '활동',
    cell: (row) => row.activeStudentCount,
    cellClassName: 'tabular-nums',
  },
  {
    id: 'participantCount',
    header: '참여',
    cell: (row) => row.participantCount,
    cellClassName: 'tabular-nums',
  },
  ...ACTIVITY_METRICS.map(
    (metric): DataTableColumn<StaffInsightsDepartmentRow> => ({
      id: metric.field,
      header: metric.label,
      cell: (row) => row[metric.field],
      cellClassName: 'tabular-nums',
    }),
  ),
];

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
          Commit · PR · Issue · Repo · Star를 합산합니다. Star는 계정 전체
          누적이며 프로그램 신청은 포함하지 않습니다. 학과 미등록은 별도로
          집계하며 아래 비교 막대에서는 제외합니다.
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
                tick={{
                  fill: 'var(--muted-foreground)',
                  fontSize: 'var(--step-badge)',
                }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                width={44}
                tick={{
                  fill: 'var(--muted-foreground)',
                  fontSize: 'var(--step-badge)',
                }}
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
          현재 프로필에 등록된 학과별로, 활동 합계가 큰 순서입니다. Commit · PR
          · Issue · Repo · Star를 합산하며, Star는 계정 전체 누적입니다.
          프로그램 신청은 활동 합계에 포함하지 않습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={DEPARTMENT_COLUMNS}
          data={[...summary.departments]}
          rowKey={(row) => row.department}
          caption="학과별 학생 수와 랭킹 지표"
          hideCaption
          scrollRegionLabel="학과별 학생 수와 랭킹 지표"
        />
      </CardContent>
    </Card>
  );
}
