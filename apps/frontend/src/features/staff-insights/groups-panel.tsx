'use client';

import { useState, type ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, FilterChip, FilterChipGroup } from '@/components';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { cohortRow, rate } from './insights-model';
import {
  COHORT_LABELS,
  DEPARTMENT_COHORTS,
  type StaffInsightsDepartmentRow,
  type StaffInsightsSummary,
} from './types';

const chartMinimumHeight = 320;
const chartMaximumHeight = 560;
const departmentRowHeight = 52;
const scrollHintId = 'department-chart-scroll-hint';

const DEPARTMENT_SORTS = {
  STUDENT_COUNT: 'studentCount',
  ACTIVITY_PER_STUDENT: 'activityPerStudent',
} as const;

type DepartmentSort = (typeof DEPARTMENT_SORTS)[keyof typeof DEPARTMENT_SORTS];

const SORT_OPTIONS: readonly {
  readonly value: DepartmentSort;
  readonly label: string;
}[] = [
  { value: DEPARTMENT_SORTS.STUDENT_COUNT, label: '가입 학생 수' },
  { value: DEPARTMENT_SORTS.ACTIVITY_PER_STUDENT, label: '1인당 활동량' },
];

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return '계산 불가';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function KpiTile({
  label,
  value,
  ratio,
}: {
  readonly label: string;
  readonly value: string;
  readonly ratio?: string;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="break-keep">{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      {ratio === undefined ? null : (
        <CardContent>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground tabular-nums">
            {ratio}
          </span>
        </CardContent>
      )}
    </Card>
  );
}

function CohortKpiGrid({
  summary,
}: {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  const cohorts = [DEPARTMENT_COHORTS.SW_MAJOR, DEPARTMENT_COHORTS.NON_SW].map(
    (cohort) => cohortRow(summary, cohort),
  );
  const unregistered = cohortRow(summary, DEPARTMENT_COHORTS.UNREGISTERED);
  return (
    <section
      aria-label="전공별 지표"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {cohorts.map((row) => {
        const label = COHORT_LABELS[row.cohort];
        const registered = row.studentCount;
        return [
          <KpiTile
            key={`${row.cohort}-registered`}
            label={`${label} 가입 학생`}
            value={`${registered}명`}
          />,
          <KpiTile
            key={`${row.cohort}-active`}
            label={`${label} 활동률`}
            value={percent(row.activeStudentCount, registered)}
            ratio={
              registered === 0
                ? undefined
                : rate(row.activeStudentCount, registered)
            }
          />,
          <KpiTile
            key={`${row.cohort}-participation`}
            label={`${label} 프로그램 참여율`}
            value={percent(row.participantCount, registered)}
            ratio={
              registered === 0
                ? undefined
                : rate(row.participantCount, registered)
            }
          />,
        ];
      })}
      <KpiTile
        label={COHORT_LABELS[DEPARTMENT_COHORTS.UNREGISTERED]}
        value={`${unregistered.studentCount}명`}
      />
    </section>
  );
}

interface DepartmentNameTickProps {
  readonly x?: number;
  readonly y?: number;
  readonly payload?: { readonly value: string };
}

function DepartmentNameTick({
  x = 0,
  y = 0,
  payload,
}: DepartmentNameTickProps): ReactElement | null {
  if (payload === undefined) return null;
  return (
    <g>
      <title>{payload.value}</title>
      <foreignObject x={0} y={y - 20} width={Math.max(x - 8, 0)} height={40}>
        <div
          className={cn(
            'recharts-text recharts-cartesian-axis-tick-value overflow-hidden',
            'text-ellipsis whitespace-nowrap text-right text-muted-foreground',
          )}
          style={{ fontSize: 'var(--step-badge)', lineHeight: 1.5 }}
          title={payload.value}
        >
          {payload.value}
        </div>
      </foreignObject>
    </g>
  );
}

function compareBy(
  sort: DepartmentSort,
): (a: StaffInsightsDepartmentRow, b: StaffInsightsDepartmentRow) => number {
  return (a, b) =>
    b[sort] - a[sort] || a.department.localeCompare(b.department, 'ko');
}

function DepartmentChart({
  rows,
  sort,
}: {
  readonly rows: readonly StaffInsightsDepartmentRow[];
  readonly sort: DepartmentSort;
}): ReactElement {
  const data = rows.map((row) => ({
    name: row.department,
    swMajor: row.cohort === DEPARTMENT_COHORTS.SW_MAJOR ? row[sort] : 0,
    nonSw: row.cohort === DEPARTMENT_COHORTS.NON_SW ? row[sort] : 0,
  }));
  const chartHeight = Math.max(
    chartMinimumHeight,
    data.length * departmentRowHeight,
  );
  const isScrollable = chartHeight > chartMaximumHeight;
  const metricLabel = SORT_OPTIONS.find((option) => option.value === sort)
    ?.label;
  return (
    <>
      {isScrollable ? (
        <p id={scrollHintId} className="mb-2 text-xs text-muted-foreground">
          학과가 많아 차트 안에서 세로로 스크롤할 수 있습니다.
        </p>
      ) : null}
      <div
        data-slot="department-chart-viewport"
        role={isScrollable ? 'region' : undefined}
        aria-label={isScrollable ? '학과 순위 차트' : undefined}
        aria-describedby={isScrollable ? scrollHintId : undefined}
        tabIndex={isScrollable ? 0 : undefined}
        className="w-full overflow-y-auto rounded-md"
        style={{ maxHeight: chartMaximumHeight }}
      >
        <div
          className="w-full"
          style={{ height: chartHeight }}
          aria-hidden="true"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              accessibilityLayer={false}
              layout="vertical"
              data={data}
              margin={{ top: 8, right: 28, left: 0, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                orientation="top"
                height={40}
                tickCount={3}
                allowDecimals={sort === DEPARTMENT_SORTS.ACTIVITY_PER_STUDENT}
                tick={{
                  fill: 'var(--muted-foreground)',
                  fontSize: 'var(--step-badge)',
                }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={168}
                tick={<DepartmentNameTick />}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <Tooltip />
              <Bar
                dataKey="swMajor"
                stackId="department"
                name={COHORT_LABELS[DEPARTMENT_COHORTS.SW_MAJOR]}
                fill="var(--primary)"
              />
              <Bar
                dataKey="nonSw"
                stackId="department"
                name={COHORT_LABELS[DEPARTMENT_COHORTS.NON_SW]}
                fill="var(--accent)"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div
        data-slot="department-chart-legend"
        className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground"
        aria-hidden="true"
      >
        <span className="flex items-center gap-1">
          <span className="size-3 bg-primary" />
          {COHORT_LABELS[DEPARTMENT_COHORTS.SW_MAJOR]}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 bg-accent" />
          {COHORT_LABELS[DEPARTMENT_COHORTS.NON_SW]}
        </span>
      </div>
      <div className="sr-only">
        <table>
          <caption>{`학과 순위 (${metricLabel} 기준)`}</caption>
          <thead>
            <tr>
              <th>순위</th>
              <th>학과</th>
              <th>구분</th>
              <th>가입 학생</th>
              <th>활동 학생</th>
              <th>참여 학생</th>
              <th>1인당 활동량</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.department}>
                <td>{index + 1}</td>
                <td>{row.department}</td>
                <td>{COHORT_LABELS[row.cohort]}</td>
                <td>{row.studentCount}</td>
                <td>{row.activeStudentCount}</td>
                <td>{row.participantCount}</td>
                <td>{row.activityPerStudent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DepartmentRanking({
  departments,
}: {
  readonly departments: readonly StaffInsightsDepartmentRow[];
}): ReactElement {
  const [sort, setSort] = useState<DepartmentSort>(
    DEPARTMENT_SORTS.STUDENT_COUNT,
  );
  const ranked = departments.filter(
    (row) => row.cohort !== DEPARTMENT_COHORTS.UNREGISTERED,
  );
  if (ranked.length === 0) {
    return (
      <EmptyState
        title="학과별 학생이 없습니다"
        description="학과를 등록한 학생이 생기면 학과 순위가 나타납니다."
      />
    );
  }
  const perStudent = sort === DEPARTMENT_SORTS.ACTIVITY_PER_STUDENT;
  const smallSamples = perStudent
    ? ranked.filter((row) => row.sampleTooSmall)
    : [];
  const chartRows = ranked
    .filter((row) => !perStudent || !row.sampleTooSmall)
    .sort(compareBy(sort));
  return (
    <Card>
      <CardHeader>
        <CardTitle>학과 순위</CardTitle>
        <CardDescription>
          현재 프로필에 등록된 학과 기준이며 학과 미등록 학생은 제외합니다.
          1인당 활동량은 공개 활동 합계(Commit · PR · Issue · Repo · Star)를
          가입 학생 수로 나눈 값입니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FilterChipGroup aria-label="학과 순위 기준">
          {SORT_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              pressed={sort === option.value}
              onClick={() => setSort(option.value)}
            >
              {option.label}
            </FilterChip>
          ))}
        </FilterChipGroup>
        {chartRows.length === 0 ? (
          <EmptyState
            title="1인당 순위를 낼 학과가 없습니다"
            description="가입 학생이 3명 이상인 학과가 생기면 1인당 활동량 순위가 나타납니다."
          />
        ) : (
          <div>
            <DepartmentChart rows={chartRows} sort={sort} />
          </div>
        )}
        {smallSamples.length === 0 ? null : (
          <p
            data-slot="department-small-samples"
            className="text-sm text-muted-foreground break-keep"
          >
            {`표본 적음 (가입 3명 미만): ${smallSamples
              .map((row) => row.department)
              .join(', ')}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function GroupsTab({
  summary,
}: {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  return (
    <div className="grid gap-6">
      <CohortKpiGrid summary={summary} />
      <DepartmentRanking departments={summary.departments} />
    </div>
  );
}
