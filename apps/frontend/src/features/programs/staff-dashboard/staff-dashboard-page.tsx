'use client';

import type { ReactElement } from 'react';
import { useStaffDashboardUrlState } from './staff-dashboard-url-state';
import { useStaffDashboardQuery } from './queries';
import { ApiError } from '@/lib/api-client';
import {
  buildStaffDashboardPageModel,
  type StaffDashboardPageModel,
} from './staff-dashboard-page-model';
import { DEFAULT_STAFF_DASHBOARD_ORDER } from './staff-dashboard-overview';
import {
  StaffDashboardPageView,
  type StaffDashboardPageViewState,
} from './staff-dashboard-page-view';
import type { StaffDashboardSummary } from './dto';

export { StaffDashboardPageView } from './staff-dashboard-page-view';
export { buildStaffDashboardPageModel } from './staff-dashboard-page-model';
export { StaffDashboardOverview } from './staff-dashboard-overview';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly summary: StaffDashboardSummary }
  | { readonly kind: 'error'; readonly message: string };

function getStaffDashboardErrorMessage(error: unknown): string {
  return error instanceof ApiError && error.problem.status === 403
    ? '승인된 교직원 또는 관리자만 조회할 수 있습니다.'
    : '운영 대시보드를 불러오지 못했습니다.';
}

export function StaffDashboardPage(): ReactElement {
  const { state: urlState, navigate } = useStaffDashboardUrlState();
  const { page, search, status, sort, direction } = urlState;
  const order =
    sort === undefined || direction === undefined
      ? DEFAULT_STAFF_DASHBOARD_ORDER
      : { sort, direction };
  const query = useStaffDashboardQuery({ page, search, status, ...order });
  const loadState: LoadState = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? { kind: 'error', message: getStaffDashboardErrorMessage(query.error) }
      : { kind: 'ready', summary: query.data };
  if (loadState.kind === 'loading') {
    return <StaffDashboardPageView state={{ kind: 'loading' }} />;
  }
  if (loadState.kind === 'error') {
    return (
      <StaffDashboardPageView
        state={{
          kind: 'error',
          message: loadState.message,
          onRetry: () => void query.refetch(),
        }}
      />
    );
  }

  const model: StaffDashboardPageModel = buildStaffDashboardPageModel(
    loadState.summary,
  );
  const state: StaffDashboardPageViewState = {
    kind: 'ready',
    model,
    order,
    now: new Date(),
    actions: {
      onResetFilters: () => navigate({ search: '', status: 'all', page: 1 }),
      onPageChange: (nextPage) => navigate({ page: nextPage }),
      onSortChange: (nextOrder) => navigate({ ...nextOrder, page: 1 }),
    },
  };
  return <StaffDashboardPageView state={state} />;
}
