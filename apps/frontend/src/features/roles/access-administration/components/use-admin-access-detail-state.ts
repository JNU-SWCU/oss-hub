'use client';

import { useState } from 'react';
import { skipToken, useQuery, type QueryKey } from '@tanstack/react-query';
import {
  fetchAdminAccessHistory,
  type AdminAccessHistory,
  type AdminAccessHistoryParams,
} from '../admin-access-api';
import {
  ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
  AdminAccessDetailNotFoundError,
  type AdminAccessDetailData,
} from '../admin-access-detail-api';
import { adminAccessHistoryKey, useAdminAccessDetailQuery } from '../queries';
import type { AdminAccessDetailState } from './admin-access-detail-content';

export function useAdminAccessDetailState(userId: string) {
  const query = useAdminAccessDetailQuery(userId);
  const [historyPage, setHistoryPage] = useState<{
    readonly source: AdminAccessDetailData;
    readonly kind: 'staffAccessRequest' | 'login';
    readonly params: AdminAccessHistoryParams;
    readonly previousKey: QueryKey;
  } | null>(null);
  const selectedHistory =
    historyPage?.source === query.data ? historyPage : null;
  const historyKey = adminAccessHistoryKey(
    userId,
    query.dataUpdatedAt,
    selectedHistory?.params ?? null,
  );
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: selectedHistory
      ? ({ signal }) =>
          fetchAdminAccessHistory(userId, selectedHistory.params, signal)
      : skipToken,
  });
  const previousHistoryQuery = useQuery<AdminAccessHistory>({
    queryKey: selectedHistory?.previousKey ?? historyKey,
    queryFn: skipToken,
  });
  const history =
    historyQuery.data ?? previousHistoryQuery.data ?? query.data?.history;
  const state: AdminAccessDetailState =
    query.data !== undefined && history !== undefined
      ? { kind: 'ready', ...query.data, history }
      : query.isError
        ? query.error instanceof AdminAccessDetailNotFoundError
          ? { kind: 'not-found' }
          : { kind: 'error' }
        : { kind: 'loading' };
  const retry = () => void query.refetch();
  const historyLoading = historyQuery.isFetching;
  const historyFailure = historyQuery.isError ? selectedHistory : null;
  const changeHistoryPage = (
    kind: 'staffAccessRequest' | 'login',
    page: number,
  ) => {
    if (state.kind !== 'ready' || query.data === undefined) return;
    setHistoryPage({
      source: query.data,
      kind,
      params: {
        staffAccessRequestPage:
          kind === 'staffAccessRequest'
            ? page
            : state.history.staffAccessRequests.page,
        staffAccessRequestLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
        loginPage: kind === 'login' ? page : state.history.loginHistory.page,
        loginLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
      },
      previousKey: historyFailure?.previousKey ?? historyKey,
    });
  };

  return {
    state,
    retry,
    historyLoading,
    changeHistoryPage,
    historyError: historyFailure
      ? {
          message: `${historyFailure.kind === 'login' ? '로그인' : '요청'} 이력을 불러오지 못했습니다. 이전 목록은 그대로 남아 있습니다.`,
          onRetry: () => void historyQuery.refetch(),
        }
      : null,
  };
}
