import type { ReactElement } from 'react';
import { DataTable, EmptyState, type DataTableColumn } from '@/components';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricHint } from './insights-controls';
import { KpiTile } from './kpi-tile';
import {
  DEPARTMENT_COHORTS,
  type StaffInsightsDepartmentRow,
  type StaffInsightsSummary,
} from './types';

const HEAD = 'px-3 sm:px-4';
const CELL = 'px-3 py-3 sm:px-4';
const NUMBER_HEAD = `${HEAD} text-right`;
const NUMBER_CELL = `${CELL} text-right tabular-nums`;

const DEPARTMENT_COLUMNS: DataTableColumn<StaffInsightsDepartmentRow>[] = [
  {
    id: 'department',
    header: '학과',
    headClassName: HEAD,
    cellClassName: `${CELL} text-table text-foreground`,
    rowHeader: true,
    cell: (row) => row.department,
  },
  {
    id: 'major',
    header: '전공',
    headClassName: HEAD,
    cellClassName: CELL,
    cell: (row) => (
      <span className="inline-flex items-center gap-2">
        {row.major ?? '—'}
        {row.sampleTooSmall ? (
          <span className="text-xs text-muted-foreground">표본 적음</span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'studentCount',
    header: '가입 학생',
    headClassName: NUMBER_HEAD,
    cellClassName: NUMBER_CELL,
    cell: (row) => row.studentCount,
  },
  {
    id: 'activeStudentRate',
    header: '활동 학생 비율',
    headClassName: NUMBER_HEAD,
    cellClassName: NUMBER_CELL,
    cell: (row) =>
      row.studentCount === 0
        ? '—'
        : `${Math.round((row.activeStudentCount / row.studentCount) * 100)}%`,
  },
  {
    id: 'activityPerStudent',
    header: (
      <span className="inline-flex items-center gap-1">
        1인당 활동 합계
        <MetricHint
          label="1인당 활동 합계"
          description="선택한 기간의 공개 활동 합계를 가입 학생 수로 나눈 값입니다."
        />
      </span>
    ),
    headClassName: NUMBER_HEAD,
    headProps: { 'aria-sort': 'descending' },
    cellClassName: `${NUMBER_CELL} font-semibold`,
    cell: (row) =>
      row.studentCount === 0 ? '—' : row.activityPerStudent.toFixed(1),
  },
  {
    id: 'recentPerStudent',
    header: (
      <span className="inline-flex items-center gap-1">
        1인당 최근 30일
        <MetricHint
          label="1인당 최근 30일"
          description="최근 30일의 공개 활동 증가분을 가입 학생 수로 나눈 값입니다. 스타는 제외합니다."
        />
      </span>
    ),
    headClassName: NUMBER_HEAD,
    cellClassName: NUMBER_CELL,
    cell: (row) => row.recentPerStudent?.toFixed(1) ?? '—',
  },
];

export function GroupsTab({
  summary,
}: {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  const students = summary.cohorts.reduce(
    (sum, row) => sum + row.studentCount,
    0,
  );
  const active = summary.cohorts.reduce(
    (sum, row) => sum + row.activeStudentCount,
    0,
  );
  const rows = summary.departments
    .filter((row) => row.cohort !== DEPARTMENT_COHORTS.UNREGISTERED)
    .sort(
      (a, b) =>
        b.activityPerStudent - a.activityPerStudent ||
        a.department.localeCompare(b.department, 'ko'),
    );
  const departmentCount = new Set(rows.map((row) => row.department)).size;

  return (
    <>
      <section
        aria-label="학과·전공 지표"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3"
      >
        <KpiTile compact label="가입 학생" value={`${students}명`} />
        <KpiTile compact label="활동 학생" value={`${active}명`} />
        <KpiTile compact label="학과 수" value={`${departmentCount}개`} />
      </section>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>학과·전공</CardTitle>
        </CardHeader>
        {rows.length === 0 ? (
          <CardContent>
            <EmptyState title="학과별 학생이 없습니다" />
          </CardContent>
        ) : (
          <DataTable
            columns={DEPARTMENT_COLUMNS}
            data={rows}
            rowKey={(row) => JSON.stringify([row.department, row.major])}
            scrollRegionLabel="학과·전공 표"
          />
        )}
      </Card>
    </>
  );
}
