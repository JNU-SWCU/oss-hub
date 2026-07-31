'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api-client';

import { fetchAdminAccessList } from '../admin-access-api';
import type {
  AdminAccessAccountStatus,
  AdminAccessListItem,
  AdminAccessPendingFilter,
  AdminAccessRoleFilter,
  AdminAccessSortDirection,
  AdminAccessSortField,
} from '../admin-access-api';
import {
  ADMIN_ACCESS_DEFAULT_FILTER_STATE,
  ADMIN_ACCESS_LIST_LIMIT,
  buildAdminAccessListParams,
} from '../admin-access-list-query';
import { AdminAccessView } from './admin-access-view';

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.problem.detail
    : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

/**
 * Read-only `/admin/access` list screen (PR04C). No PATCH/mutation
 * affordances — the unified writer lands in PR04G. Filter/sort/page state
 * is local component state; PR04D promotes it into URL query params.
 */
export function AdminAccessScreen() {
  const [items, setItems] = useState<readonly AdminAccessListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [queryInput, setQueryInput] = useState(
    ADMIN_ACCESS_DEFAULT_FILTER_STATE.query,
  );
  const [query, setQuery] = useState(ADMIN_ACCESS_DEFAULT_FILTER_STATE.query);
  const [role, setRole] = useState<AdminAccessRoleFilter | ''>(
    ADMIN_ACCESS_DEFAULT_FILTER_STATE.role,
  );
  const [accountStatus, setAccountStatus] = useState<
    AdminAccessAccountStatus | ''
  >(ADMIN_ACCESS_DEFAULT_FILTER_STATE.accountStatus);
  const [pendingRequest, setPendingRequest] = useState<
    AdminAccessPendingFilter | ''
  >(ADMIN_ACCESS_DEFAULT_FILTER_STATE.pendingRequest);
  const [sort, setSort] = useState<AdminAccessSortField>(
    ADMIN_ACCESS_DEFAULT_FILTER_STATE.sort,
  );
  const [direction, setDirection] = useState<AdminAccessSortDirection>(
    ADMIN_ACCESS_DEFAULT_FILTER_STATE.direction,
  );
  const [page, setPage] = useState(ADMIN_ACCESS_DEFAULT_FILTER_STATE.page);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = buildAdminAccessListParams({
        query,
        role,
        accountStatus,
        pendingRequest,
        sort,
        direction,
        page,
      });
      const result = await fetchAdminAccessList(params);
      setItems(result.items);
      setTotal(result.total);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [query, role, accountStatus, pendingRequest, sort, direction, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetFilters = () => {
    setQueryInput(ADMIN_ACCESS_DEFAULT_FILTER_STATE.query);
    setQuery(ADMIN_ACCESS_DEFAULT_FILTER_STATE.query);
    setRole(ADMIN_ACCESS_DEFAULT_FILTER_STATE.role);
    setAccountStatus(ADMIN_ACCESS_DEFAULT_FILTER_STATE.accountStatus);
    setPendingRequest(ADMIN_ACCESS_DEFAULT_FILTER_STATE.pendingRequest);
    setSort(ADMIN_ACCESS_DEFAULT_FILTER_STATE.sort);
    setDirection(ADMIN_ACCESS_DEFAULT_FILTER_STATE.direction);
    setPage(ADMIN_ACCESS_DEFAULT_FILTER_STATE.page);
  };

  return (
    <AdminAccessView
      items={items}
      query={queryInput}
      role={role}
      accountStatus={accountStatus}
      pendingRequest={pendingRequest}
      sort={sort}
      direction={direction}
      page={page}
      limit={ADMIN_ACCESS_LIST_LIMIT}
      total={total}
      isLoading={isLoading}
      errorMessage={error}
      onQueryChange={setQueryInput}
      onSearch={() => {
        setQuery(queryInput.trim());
        setPage(1);
      }}
      onRoleChange={(nextRole) => {
        setRole(nextRole);
        setPage(1);
      }}
      onAccountStatusChange={(nextStatus) => {
        setAccountStatus(nextStatus);
        setPage(1);
      }}
      onPendingRequestChange={(nextPendingRequest) => {
        setPendingRequest(nextPendingRequest);
        setPage(1);
      }}
      onSortChange={(nextSort) => {
        setSort(nextSort);
        setPage(1);
      }}
      onDirectionToggle={() => {
        setDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
        setPage(1);
      }}
      onPageChange={setPage}
      onRetry={() => void load()}
      onResetFilters={resetFilters}
    />
  );
}
