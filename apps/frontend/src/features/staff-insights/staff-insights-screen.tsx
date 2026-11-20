'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api-client';
import type {
  StaffInsightsFinderProps,
  StaffInsightsFinderQuery,
} from './leaderboard-panel';
import { useStaffInsightsFinderQuery, useStaffInsightsQuery } from './queries';
import { useStaffInsightsUrlState } from './staff-insights-url-state';
import { StaffInsightsView } from './staff-insights-view';

const DEFAULT_FINDER_QUERY: StaffInsightsFinderQuery = {
  search: '',
  department: '',
  programId: '',
  minActivity: 0,
  recentActivity: 'all',
  sort: 'total',
  direction: 'desc',
  page: 1,
};

export function StaffInsightsScreen() {
  const {
    state: { scope, view },
    onScopeChange,
  } = useStaffInsightsUrlState();
  const year = scope.kind === 'calendar' ? scope.year : null;
  const [finder, setFinder] = useState({ year, query: DEFAULT_FINDER_QUERY });
  const finderQuery =
    finder.year === year ? finder.query : { ...finder.query, page: 1 };
  if (finder.year !== year) setFinder({ year, query: finderQuery });

  const summary = useStaffInsightsQuery(scope);
  const students = useStaffInsightsFinderQuery(
    scope,
    view === 'finder' ? finderQuery : undefined,
  );

  if (summary.isPending) {
    return <StaffInsightsView state={{ kind: 'loading' }} />;
  }
  if (summary.isError) {
    return (
      <StaffInsightsView
        state={{
          kind: 'error',
          message: staffInsightsErrorMessage(
            summary.error,
            '인사이트를 불러오지 못했습니다.',
          ),
          onRetry: () => void summary.refetch(),
        }}
      />
    );
  }
  const ready = {
    kind: 'ready' as const,
    summary: summary.data,
    onScopeChange,
  };
  if (view !== 'finder')
    return <StaffInsightsView state={{ ...ready, view }} />;

  let result: StaffInsightsFinderProps['result'];
  if (students.isPending) {
    result = { kind: 'loading' };
  } else if (students.isError) {
    result = {
      kind: 'error',
      message: staffInsightsErrorMessage(
        students.error,
        '잠시 후 다시 시도해 주세요.',
      ),
      onRetry: () => void students.refetch(),
    };
  } else {
    result = { kind: 'ready', data: students.data };
  }
  return (
    <StaffInsightsView
      state={{
        ...ready,
        view,
        finder: {
          query: finderQuery,
          onQueryChange: (query) => setFinder({ year, query }),
          result,
        },
      }}
    />
  );
}

function staffInsightsErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.problem.status === 403
    ? '승인된 교직원 또는 관리자만 조회할 수 있습니다.'
    : fallback;
}
