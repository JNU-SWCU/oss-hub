'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { ApiError } from '@/lib/api-client';
import { getStaffDashboardSummary } from './api';
import {
  buildStaffDashboardPageModel,
  type StaffDashboardPageModel,
} from './staff-dashboard-page-model';
import {
  StaffDashboardPageView,
  type StaffDashboardPageViewState,
} from './staff-dashboard-page-view';
import type { ProgramListStatus, StaffDashboardSummary } from './types';

export { StaffDashboardPageView } from './staff-dashboard-page-view';
export {
  buildStaffDashboardPageModel,
  type StaffDashboardPageModel,
} from './staff-dashboard-page-model';
export { StaffDashboardOverview } from './staff-dashboard-overview';
export { StaffDashboardStatusSummary } from './staff-dashboard-status-summary';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly summary: StaffDashboardSummary }
  | { readonly kind: 'error'; readonly message: string };

export function getStaffDashboardErrorMessage(error: unknown): string {
  return error instanceof ApiError && error.problem.status === 403
    ? '승인된 교직원 또는 관리자만 조회할 수 있습니다.'
    : '운영 대시보드를 불러오지 못했습니다.';
}

export function StaffDashboardPage(): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProgramListStatus>('all');
  const [page, setPage] = useState(1);
  const latestRequestId = useRef(0);
  const now = useMemo(() => new Date(), []);

  const load = useCallback(async (): Promise<void> => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setLoadState({ kind: 'loading' });
    try {
      const summary = await getStaffDashboardSummary();
      if (requestId === latestRequestId.current) {
        setLoadState({ kind: 'ready', summary });
      }
    } catch (error: unknown) {
      if (requestId !== latestRequestId.current) return;
      setLoadState({
        kind: 'error',
        message: getStaffDashboardErrorMessage(error),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadState.kind === 'loading') {
    return <StaffDashboardPageView state={{ kind: 'loading' }} />;
  }
  if (loadState.kind === 'error') {
    return (
      <StaffDashboardPageView
        state={{
          kind: 'error',
          message: loadState.message,
          onRetry: () => void load(),
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
    search,
    status,
    now,
    actions: {
      onSearchChange: (value) => {
        setSearch(value);
        setPage(1);
      },
      onStatusChange: (value) => {
        setStatus(value);
        setPage(1);
      },
      onSubmit: () => setPage(1),
      onResetFilters: () => {
        setSearch('');
        setStatus('all');
        setPage(1);
      },
      onPageChange: setPage,
    },
  };
  return <StaffDashboardPageView state={state} />;
}
