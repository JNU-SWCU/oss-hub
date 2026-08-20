import Link from 'next/link';
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
import { EmptyState, PageHeader } from '@/components';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FadeUp } from './fade-up';
import { insightsPageHref } from './insights-year';
import {
  COHORT_LABELS,
  DEPARTMENT_COHORTS,
  INSIGHTS_CUTS,
  type InsightsCut,
  type InsightsYearScope,
  type StaffInsightsCohortRow,
  type StaffInsightsMetrics,
  type StaffInsightsSummary,
} from './types';

export type StaffInsightsViewState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly onRetry: () => void;
    }
  | {
      readonly kind: 'ready';
      readonly summary: StaffInsightsSummary;
      readonly cut: InsightsCut;
      readonly onCutChange: (cut: InsightsCut) => void;
    };

const COHORT_CHART_KEYS = [
  { key: 'swMajor', label: COHORT_LABELS[DEPARTMENT_COHORTS.SW_MAJOR] },
  { key: 'nonSw', label: COHORT_LABELS[DEPARTMENT_COHORTS.NON_SW] },
] as const;

type ActivityMetricField =
  | 'commitCount'
  | 'pullRequestCount'
  | 'issueCount'
  | 'repositoryCount'
  | 'starCount'
  | 'total';

const ACTIVITY_METRICS: readonly {
  readonly field: ActivityMetricField;
  readonly label: string;
}[] = [
  { field: 'commitCount', label: 'Commit' },
  { field: 'pullRequestCount', label: 'PR' },
  { field: 'issueCount', label: 'Issue' },
  { field: 'repositoryCount', label: 'Repo' },
  { field: 'starCount', label: 'Star(누적)' },
  { field: 'total', label: '합계' },
];

const EMPTY_COHORT_METRICS: StaffInsightsMetrics = {
  studentCount: 0,
  activeStudentCount: 0,
  commitCount: 0,
  pullRequestCount: 0,
  issueCount: 0,
  repositoryCount: 0,
  starCount: 0,
  total: 0,
  participantCount: 0,
};

export function StaffInsightsView({
  state,
}: {
  readonly state: StaffInsightsViewState;
}): ReactElement {
  if (state.kind === 'loading') {
    return (
      <main
        className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8"
        aria-label="학생 활성을 불러오는 중"
      >
        <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
        <div className="h-64 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      </main>
    );
  }
  if (state.kind === 'error') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <EmptyState
          title="학생 활성을 불러오지 못했습니다"
          description={state.message}
          action={
            <Button type="button" onClick={state.onRetry}>
              다시 시도
            </Button>
          }
        />
      </main>
    );
  }

  const { summary, cut, onCutChange } = state;
  const sw = cohortRow(summary, DEPARTMENT_COHORTS.SW_MAJOR);
  const nonSw = cohortRow(summary, DEPARTMENT_COHORTS.NON_SW);
  const unregistered = cohortRow(summary, DEPARTMENT_COHORTS.UNREGISTERED);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <PageHeader
        title="학생 활성"
        description="가입 학과를 SW전공과 비SW전공으로 접어, 랭킹 지표와 프로그램 참여를 따로 비교합니다. 활성은 공개 랭킹과 같은 commit · PR · issue · repo · star이고, Star는 계정 전체 누적입니다. 참여는 현재 승인된 프로그램입니다."
      />
      <section
        className="flex flex-wrap items-center gap-3"
        aria-label="기간과 비교 단위"
      >
        <YearLinks scope={summary.scope} years={summary.years} />
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="비교 단위"
        >
          <CutButton
            current={cut}
            value={INSIGHTS_CUTS.COHORT}
            onCutChange={onCutChange}
          >
            전공·비전공
          </CutButton>
          <CutButton
            current={cut}
            value={INSIGHTS_CUTS.DEPARTMENT}
            onCutChange={onCutChange}
          >
            학과
          </CutButton>
        </div>
      </section>
      <p className="text-sm text-muted-foreground">
        {scopeCaption(summary.scope)}
        {summary.dataAsOf === null
          ? ' · 수집 시각 없음'
          : ` · 기준 ${summary.dataAsOf.toLocaleString('ko-KR')}`}
      </p>
      <section
        className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(16rem,100%),1fr))]"
        aria-label="요약"
      >
        <FadeUp delayMs={0}>
          <MetricCard
            title="가입 학생"
            sw={sw.studentCount}
            nonSw={nonSw.studentCount}
            extra={`미등록 ${unregistered.studentCount}`}
          />
        </FadeUp>
        <FadeUp delayMs={60}>
          <MetricCard
            title="활동 학생"
            sw={sw.activeStudentCount}
            nonSw={nonSw.activeStudentCount}
            extra="랭킹 합계가 1 이상"
          />
        </FadeUp>
        <FadeUp delayMs={120}>
          <MetricCard
            title="프로그램 참여자"
            sw={sw.participantCount}
            nonSw={nonSw.participantCount}
            extra={`미등록 ${unregistered.participantCount}`}
          />
        </FadeUp>
      </section>
      {cut === INSIGHTS_CUTS.COHORT ? (
        <ActivityPanel sw={sw} nonSw={nonSw} />
      ) : (
        <DepartmentPanel summary={summary} />
      )}
      <ParticipationPanel summary={summary} />
    </main>
  );
}

function YearLinks({
  scope,
  years,
}: {
  readonly scope: InsightsYearScope;
  readonly years: readonly number[];
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="기간">
      <YearLink
        href={insightsPageHref({ kind: 'all' })}
        current={scope.kind === 'all'}
      >
        전체
      </YearLink>
      {years.map((year) => (
        <YearLink
          key={year}
          href={insightsPageHref({ kind: 'calendar', year })}
          current={scope.kind === 'calendar' && scope.year === year}
        >
          {String(year)}
        </YearLink>
      ))}
    </div>
  );
}

function YearLink({
  href,
  current,
  children,
}: {
  readonly href: string;
  readonly current: boolean;
  readonly children: string;
}): ReactElement {
  return (
    <Button asChild variant={current ? 'default' : 'outline'} size="sm">
      <Link href={href} aria-current={current ? 'page' : undefined}>
        {children}
      </Link>
    </Button>
  );
}

function CutButton({
  current,
  value,
  onCutChange,
  children,
}: {
  readonly current: InsightsCut;
  readonly value: InsightsCut;
  readonly onCutChange: (cut: InsightsCut) => void;
  readonly children: string;
}): ReactElement {
  return (
    <Button
      type="button"
      size="sm"
      variant={current === value ? 'default' : 'outline'}
      aria-pressed={current === value}
      onClick={() => onCutChange(value)}
    >
      {children}
    </Button>
  );
}

function MetricCard({
  title,
  sw,
  nonSw,
  extra,
}: {
  readonly title: string;
  readonly sw: number;
  readonly nonSw: number;
  readonly extra: string;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{extra}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-muted-foreground">SW전공</dt>
            <dd className="text-2xl font-semibold tabular-nums">{sw}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">비SW전공</dt>
            <dd className="text-2xl font-semibold tabular-nums">{nonSw}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function ActivityPanel({
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
          않습니다.
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

function DepartmentPanel({
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

function ParticipationPanel({
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
                stackId="participants"
                fill="var(--primary)"
              />
              <Bar
                dataKey="nonSw"
                name={COHORT_LABELS[DEPARTMENT_COHORTS.NON_SW]}
                stackId="participants"
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

function cohortRow(
  summary: StaffInsightsSummary,
  cohort: (typeof DEPARTMENT_COHORTS)[keyof typeof DEPARTMENT_COHORTS],
): StaffInsightsCohortRow {
  const row = summary.cohorts.find((item) => item.cohort === cohort);
  if (row === undefined) {
    return { cohort, ...EMPTY_COHORT_METRICS };
  }
  return row;
}

function scopeCaption(scope: InsightsYearScope): string {
  return scope.kind === 'all' ? '기간 전체' : `${scope.year}년`;
}
