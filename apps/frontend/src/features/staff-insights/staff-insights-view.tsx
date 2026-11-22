import type { ReactElement } from 'react';
import { FailureState, PageHeader } from '@/components';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { GroupsTab } from './groups-panel';
import { PeriodSelect, ViewTabs } from './insights-controls';
import {
  FinderTab,
  StudentsTab,
  type StaffInsightsFinderProps,
} from './leaderboard-panel';
import { ProgramsTab } from './program-scorecard';
import type {
  InsightsView,
  InsightsYearScope,
  StaffInsightsSummary,
} from './types';

type ReadyState = {
  readonly kind: 'ready';
  readonly summary: StaffInsightsSummary;
  readonly onScopeChange: (scope: InsightsYearScope) => void;
} & (
  | { readonly view: Exclude<InsightsView, 'finder'> }
  | { readonly view: 'finder'; readonly finder: StaffInsightsFinderProps }
);

export type StaffInsightsViewState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly onRetry: () => void;
    }
  | ReadyState;

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
  return (
    <main className="mx-auto grid w-full min-w-0 max-w-6xl gap-6 px-4 py-8">
      <PageHeader title="인사이트" />
      <ViewTabs state={{ scope: summary.scope, view }} />
      <div className="justify-self-start">
        <PeriodSelect
          scope={summary.scope}
          years={summary.years}
          onChange={state.onScopeChange}
        />
      </div>
      {view === 'students' ? <StudentsTab summary={summary} /> : null}
      {state.view === 'finder' ? (
        <FinderTab summary={summary} {...state.finder} />
      ) : null}
      {view === 'groups' ? <GroupsTab summary={summary} /> : null}
      {view === 'programs' ? <ProgramsTab summary={summary} /> : null}
    </main>
  );
}
