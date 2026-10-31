'use client';

import { useCallback, useMemo, type ReactElement } from 'react';
import { useDebouncedUrlSearch } from '@/lib/list-url-state';
import { useStaffDashboardUrlState } from './staff-dashboard-url-state';
import { useStaffDashboardQuery } from './queries';
import { ApiError } from '@/lib/api-client';
import {
  buildStaffDashboardPageModel,
  type StaffDashboardPageModel,
} from './staff-dashboard-page-model';
import {
  StaffDashboardPageView,
  type StaffDashboardPageViewState,
} from './staff-dashboard-page-view';
import type { StaffDashboardSummary } from './dto';

export { StaffDashboardPageView } from './staff-dashboard-page-view';
export { buildStaffDashboardPageModel } from './staff-dashboard-page-model';
export { StaffDashboardOverview } from './staff-dashboard-overview';
export { StaffDashboardStatusSummary } from './staff-dashboard-status-summary';

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
  const { search, status, page } = urlState;
  const replaceSearch = useCallback(
    (value: string) => navigate({ search: value, page: 1 }, 'replace'),
    [navigate],
  );
  const [searchInput, setSearchInput] = useDebouncedUrlSearch(
    search,
    replaceSearch,
  );
  const query = useStaffDashboardQuery();
  const loadState: LoadState = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? { kind: 'error', message: getStaffDashboardErrorMessage(query.error) }
      : { kind: 'ready', summary: query.data };
  const now = useMemo(() => new Date(), []);

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

  const model: StaffDashboardPageModel = buildStaffDashboardPageModel({
    programs: loadState.summary.programs,
    search,
    status,
    page,
    now,
  });
  const state: StaffDashboardPageViewState = {
    kind: 'ready',
    model,
    search: searchInput,
    status,
    now,
    actions: {
      onSearchChange: setSearchInput,
      onStatusChange: (value) => navigate({ status: value, page: 1 }),
      onSubmit: () =>
        navigate({ search: searchInput.trim(), page: 1 }, 'replace'),
      onResetFilters: () => {
        setSearchInput('');
        navigate({ search: '', status: 'all', page: 1 });
      },
      onPageChange: (nextPage) => navigate({ page: nextPage }),
    },
  };
  return <StaffDashboardPageView state={state} />;
}
