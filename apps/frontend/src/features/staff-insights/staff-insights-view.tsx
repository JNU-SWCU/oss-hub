import type { ReactElement } from 'react';
import { FailureState, PageHeader } from '@/components';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { FadeUp } from './fade-up';
import { MetricCard, ViewTabs, YearLinks } from './insights-controls';
import { ActivityPanel, DepartmentPanel } from './insights-panels';
import { StudentsTab } from './leaderboard-panel';
import { ProgramsTab } from './participation-panel';
import { cohortRow, rate } from './insights-model';
import {
  DEPARTMENT_COHORTS,
  type InsightsView,
  type InsightsYearScope,
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
      readonly view: InsightsView;
    };

export function StaffInsightsView({
  state,
}: {
  readonly state: StaffInsightsViewState;
}): ReactElement {
  if (state.kind === 'loading') {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <Skeleton label="인사이트를 불러오는 중" className="grid gap-6">
          <SkeletonBlock className="h-20 rounded-xl" />
          <SkeletonBlock className="h-40 rounded-xl" />
          <SkeletonBlock className="h-64 rounded-xl" />
        </Skeleton>
      </main>
    );
  }
  if (state.kind === 'error') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <FailureState
          title="인사이트를 불러오지 못했습니다"
          description={state.message}
          onRetry={state.onRetry}
        />
      </main>
    );
  }

  const { summary, view } = state;
  const urlState = { scope: summary.scope, view };

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <PageHeader
        title="인사이트"
        description="학생·학과·프로그램 단위로 GitHub 활동과 참여를 봅니다."
      />
      <section className="flex flex-wrap items-end gap-4" aria-label="필터">
        <div
          className="grid gap-2"
          role="group"
          aria-labelledby="insights-period-label"
        >
          <span
            id="insights-period-label"
            className="text-xs font-semibold text-muted-foreground"
          >
            기간
          </span>
          <YearLinks state={urlState} years={summary.years} />
        </div>
      </section>
      <ViewTabs state={urlState} />
      <p className="text-sm text-muted-foreground">
        {scopeCaption(summary.scope)}
        {summary.dataAsOf === null
          ? ' · 수집 시각 없음'
          : ` · 기준 ${summary.dataAsOf.toLocaleString('ko-KR')}`}
      </p>
      {view === 'students' ? (
        <StudentsTab
          summary={summary}
          periodLabel={scopeCaption(summary.scope)}
        />
      ) : null}
      {view === 'groups' ? <GroupsTab summary={summary} /> : null}
      {view === 'programs' ? <ProgramsTab summary={summary} /> : null}
    </main>
  );
}

function GroupsTab({
  summary,
}: {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  const sw = cohortRow(summary, DEPARTMENT_COHORTS.SW_MAJOR);
  const nonSw = cohortRow(summary, DEPARTMENT_COHORTS.NON_SW);
  const unregistered = cohortRow(summary, DEPARTMENT_COHORTS.UNREGISTERED);

  return (
    <>
      <section
        className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(16rem,100%),1fr))]"
        aria-label="요약"
      >
        <FadeUp delayMs={0}>
          <MetricCard
            title="가입 학생"
            sw={sw.studentCount}
            nonSw={nonSw.studentCount}
            extra={`학과 미등록 ${unregistered.studentCount}명`}
          />
        </FadeUp>
        <FadeUp delayMs={60}>
          <MetricCard
            title="활동 학생"
            sw={sw.activeStudentCount}
            nonSw={nonSw.activeStudentCount}
            extra={
              <>
                <span className="block">활동 기준: 랭킹 합계 1 이상</span>
                <span className="inline-block">
                  SW 활동 학생 / SW 가입 학생:{' '}
                  {rate(sw.activeStudentCount, sw.studentCount)}
                </span>
                {' · '}
                <span className="inline-block">
                  비SW 활동 학생 / 비SW 가입 학생:{' '}
                  {rate(nonSw.activeStudentCount, nonSw.studentCount)}
                </span>
              </>
            }
          />
        </FadeUp>
        <FadeUp delayMs={120}>
          <MetricCard
            title="프로그램 참여자"
            sw={sw.participantCount}
            nonSw={nonSw.participantCount}
            extra={
              <>
                <span className="inline-block">
                  학과 미등록 {unregistered.participantCount}명
                </span>
                {' · '}
                <span className="inline-block">
                  SW 참여 학생 / SW 가입 학생:{' '}
                  {rate(sw.participantCount, sw.studentCount)}
                </span>
              </>
            }
          />
        </FadeUp>
      </section>
      <ActivityPanel sw={sw} nonSw={nonSw} />
      <DepartmentPanel summary={summary} />
    </>
  );
}

function scopeCaption(scope: InsightsYearScope): string {
  return scope.kind === 'all' ? '기간 전체' : `${scope.year}년`;
}
