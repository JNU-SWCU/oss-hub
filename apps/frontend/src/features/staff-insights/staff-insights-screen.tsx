'use client';

import { useState } from 'react';
import { useStaffInsightsUrlState } from './staff-insights-url-state';
import { ApiError } from '@/lib/api-client';
import { useStaffInsightsQuery } from './queries';
import { StaffInsightsView } from './staff-insights-view';
import { INSIGHTS_CUTS, type InsightsCut } from './types';

export function StaffInsightsScreen() {
  const { state: scope } = useStaffInsightsUrlState();
  const [cut, setCut] = useState<InsightsCut>(INSIGHTS_CUTS.COHORT);
  const query = useStaffInsightsQuery(scope);

  if (query.isPending) {
    return <StaffInsightsView state={{ kind: 'loading' }} />;
  }
  if (query.isError) {
    return (
      <StaffInsightsView
        state={{
          kind: 'error',
          message: staffInsightsErrorMessage(query.error),
          onRetry: () => void query.refetch(),
        }}
      />
    );
  }
  return (
    <StaffInsightsView
      state={{
        kind: 'ready',
        summary: query.data,
        cut,
        onCutChange: setCut,
      }}
    />
  );
}

function staffInsightsErrorMessage(error: unknown): string {
  return error instanceof ApiError && error.problem.status === 403
    ? '승인된 교직원 또는 관리자만 조회할 수 있습니다.'
    : '학생 활성을 불러오지 못했습니다.';
}
