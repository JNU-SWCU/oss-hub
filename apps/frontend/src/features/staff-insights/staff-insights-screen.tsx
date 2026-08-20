'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { getStaffInsights } from './api';
import { parseInsightsYearSearchParam } from './insights-year';
import { StaffInsightsView } from './staff-insights-view';
import {
  INSIGHTS_CUTS,
  type InsightsCut,
  type StaffInsightsSummary,
} from './types';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly summary: StaffInsightsSummary }
  | { readonly kind: 'error'; readonly message: string };

export function StaffInsightsScreen() {
  const searchParams = useSearchParams();
  const scope = useMemo(
    () => parseInsightsYearSearchParam(searchParams.get('year')),
    [searchParams],
  );
  const [cut, setCut] = useState<InsightsCut>(INSIGHTS_CUTS.COHORT);
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState({ kind: 'loading' });
    void getStaffInsights(scope, controller.signal)
      .then((summary) => setLoadState({ kind: 'ready', summary }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadState({
          kind: 'error',
          message: staffInsightsErrorMessage(error),
        });
      });
    return () => controller.abort();
  }, [scope, retry]);

  const retryLoad = useCallback(() => setRetry((current) => current + 1), []);

  if (loadState.kind === 'loading') {
    return <StaffInsightsView state={{ kind: 'loading' }} />;
  }
  if (loadState.kind === 'error') {
    return (
      <StaffInsightsView
        state={{
          kind: 'error',
          message: loadState.message,
          onRetry: retryLoad,
        }}
      />
    );
  }
  return (
    <StaffInsightsView
      state={{
        kind: 'ready',
        summary: loadState.summary,
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
