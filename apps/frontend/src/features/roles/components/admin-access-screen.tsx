'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { ApiError } from '@/lib/api-client';

import { fetchAdminAccessList } from '../admin-access-api';
import type { AdminAccessListItem } from '../admin-access-api';
import {
  ADMIN_ACCESS_DEFAULT_FILTER_STATE,
  ADMIN_ACCESS_LIST_LIMIT,
  buildAdminAccessListParams,
  type AdminAccessListFilterState,
} from '../admin-access-list-query';
import {
  buildAdminAccessSearchParams,
  parseAdminAccessSearchParams,
} from '../admin-access-url-state';
import { AdminAccessView } from './admin-access-view';

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.problem.detail
    : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

/**
 * `/admin/access` list screen (PR04C, URL state PR04D). Filter/sort/page
 * state lives in the URL's `searchParams` (query/role/accountStatus/
 * pendingRequest/sort/direction/page) so a refresh or a Back/Forward
 * navigation reproduces the same screen — see `admin-access-url-state.ts`
 * for the parse/serialize contract and its invalid-value policy. Sort is
 * always resolved by the 04A server contract; this screen never re-sorts
 * already-fetched rows. No PATCH/mutation affordances — the unified writer
 * lands in PR04G.
 */
export function AdminAccessScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(
    () => parseAdminAccessSearchParams(searchParams),
    [searchParams],
  );

  const [items, setItems] = useState<readonly AdminAccessListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [queryInput, setQueryInput] = useState(state.query);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tracks the last committed (trimmed) query so a Back/Forward navigation
  // that changes the URL's query resyncs the visible search box, while a
  // same-value round trip (e.g. this screen's own `navigate` call) does not
  // clobber whatever the user is currently typing.
  const committedQueryRef = useRef(state.query);
  useEffect(() => {
    if (state.query !== committedQueryRef.current) {
      committedQueryRef.current = state.query;
      setQueryInput(state.query);
    }
  }, [state.query]);

  const navigate = useCallback(
    (next: AdminAccessListFilterState) => {
      const search = buildAdminAccessSearchParams(next).toString();
      router.push(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = buildAdminAccessListParams(state);
      const result = await fetchAdminAccessList(params);
      setItems(result.items);
      setTotal(result.total);
      setPendingCount(result.facets.pendingRequests.pending);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [state]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetFilters = () => {
    committedQueryRef.current = ADMIN_ACCESS_DEFAULT_FILTER_STATE.query;
    setQueryInput(ADMIN_ACCESS_DEFAULT_FILTER_STATE.query);
    navigate(ADMIN_ACCESS_DEFAULT_FILTER_STATE);
  };

  return (
    <AdminAccessView
      items={items}
      query={queryInput}
      role={state.role}
      accountStatus={state.accountStatus}
      pendingRequest={state.pendingRequest}
      sort={state.sort}
      direction={state.direction}
      page={state.page}
      limit={ADMIN_ACCESS_LIST_LIMIT}
      total={total}
      pendingCount={pendingCount}
      isLoading={isLoading}
      errorMessage={error}
      onQueryChange={setQueryInput}
      onSearch={() => {
        const trimmed = queryInput.trim();
        committedQueryRef.current = trimmed;
        navigate({ ...state, query: trimmed, page: 1 });
      }}
      onRoleChange={(nextRole) => {
        navigate({ ...state, role: nextRole, page: 1 });
      }}
      onAccountStatusChange={(nextStatus) => {
        navigate({ ...state, accountStatus: nextStatus, page: 1 });
      }}
      onPendingRequestChange={(nextPendingRequest) => {
        navigate({ ...state, pendingRequest: nextPendingRequest, page: 1 });
      }}
      onSortChange={(nextSort) => {
        navigate({ ...state, sort: nextSort, page: 1 });
      }}
      onDirectionToggle={() => {
        navigate({
          ...state,
          direction: state.direction === 'asc' ? 'desc' : 'asc',
          page: 1,
        });
      }}
      onPageChange={(nextPage) => navigate({ ...state, page: nextPage })}
      onRetry={() => void load()}
      onResetFilters={resetFilters}
    />
  );
}
