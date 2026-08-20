import type { ReactElement } from 'react';
import { EmptyState, PageHeader } from '@/components';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FadeUp } from './fade-up';
import { CutButton, MetricCard, YearLinks } from './insights-controls';
import { ActivityPanel, DepartmentPanel } from './insights-panels';
import { ParticipationPanel } from './participation-panel';
import { cohortRow, rate } from './insights-model';
import {
  COHORT_LABELS,
  DEPARTMENT_COHORTS,
  INSIGHTS_CUTS,
  type InsightsCut,
  type InsightsYearScope,
  type StaffInsightsCohortRow,
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
      <section className="flex flex-wrap items-end gap-4" aria-label="필터">
        <div className="grid gap-2" role="group" aria-label="기간">
          <span className="text-xs font-semibold text-muted-foreground">
            기간
          </span>
          <YearLinks scope={summary.scope} years={summary.years} />
        </div>
        <div className="grid gap-2" role="group" aria-label="비교 관점">
          <span className="text-xs font-semibold text-muted-foreground">
            비교 관점
          </span>
          <div className="flex flex-wrap gap-2">
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
            extra={`미등록 ${unregistered.studentCount} · 활동률 ${rate(sw.activeStudentCount, sw.studentCount)}`}
          />
        </FadeUp>
        <FadeUp delayMs={60}>
          <MetricCard
            title="활동 학생"
            sw={sw.activeStudentCount}
            nonSw={nonSw.activeStudentCount}
            extra={`랭킹 합계가 1 이상 · 비SW ${rate(nonSw.activeStudentCount, nonSw.studentCount)}`}
          />
        </FadeUp>
        <FadeUp delayMs={120}>
          <MetricCard
            title="프로그램 참여자"
            sw={sw.participantCount}
            nonSw={nonSw.participantCount}
            extra={`미등록 ${unregistered.participantCount} · SW ${rate(sw.participantCount, sw.studentCount)}`}
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

function scopeCaption(scope: InsightsYearScope): string {
  return scope.kind === 'all' ? '기간 전체' : `${scope.year}년`;
}
