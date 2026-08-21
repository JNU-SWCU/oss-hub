import type { ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import { formatProgramChartLabel } from './program-label';
import { COHORT_LABELS, DEPARTMENT_COHORTS } from './types';
import type { StaffInsightsSummary } from './types';

const chartMinimumHeight = 320;
const chartMaximumHeight = 560;
const programRowHeight = 52;
const scrollHintId = 'participation-chart-scroll-hint';

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
  const label = formatProgramChartLabel(payload.value);
  return (
    <g>
      <title>{payload.value}</title>
      <foreignObject x={0} y={y - 20} width={Math.max(x - 8, 0)} height={40}>
        <div
          className="recharts-text recharts-cartesian-axis-tick-value overflow-hidden text-ellipsis whitespace-nowrap text-right text-muted-foreground"
          style={{ fontSize: '0.75rem', lineHeight: 1.5 }}
          title={payload.value}
        >
          {label}
        </div>
      </foreignObject>
    </g>
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
  const chartHeight = Math.max(
    chartMinimumHeight,
    data.length * programRowHeight,
  );
  const isScrollable = chartHeight > chartMaximumHeight;
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
        {isScrollable ? (
          <p
            id={scrollHintId}
            data-slot="participation-chart-scroll-hint"
            className="mb-2 text-xs text-muted-foreground"
          >
            프로그램이 많아 차트 안에서 세로로 스크롤할 수 있습니다.
          </p>
        ) : null}
        <div
          data-slot="participation-chart-viewport"
          role={isScrollable ? 'region' : undefined}
          aria-label={isScrollable ? '프로그램별 참여 차트' : undefined}
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
                layout="vertical"
                data={data}
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  type="number"
                  orientation="top"
                  height={40}
                  tickCount={3}
                  allowDecimals={false}
                  tick={{
                    fill: 'var(--muted-foreground)',
                    fontSize: '0.75rem',
                  }}
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
        </div>
        <div
          data-slot="participation-chart-legend"
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
        </div>
      </CardContent>
    </Card>
  );
}
