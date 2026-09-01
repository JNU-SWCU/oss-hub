'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { ApiError } from '@/lib/api-client';

import {
  fetchAdminAccessList,
  fetchAdminAccessRequests,
} from '../admin-access-api';
import type {
  AdminAccessListItem,
  AdminAccessSortField,
} from '../admin-access-api';
import {
  ADMIN_ACCESS_DEFAULT_FILTER_STATE,
  ADMIN_ACCESS_LIST_LIMIT,
  APPLICANT_QUEUE_DEFAULT_FILTER_STATE,
  accessDetailPath,
  buildAdminAccessListParams,
  type AccessWorkspace,
  type AdminAccessListFilterState,
} from '../admin-access-list-query';
import {
  buildAdminAccessSearchParams,
  buildApplicantQueueSearchParams,
  parseAdminAccessSearchParams,
  parseApplicantQueueSearchParams,
} from '../admin-access-url-state';
import { AdminAccessView } from './admin-access-view';

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.problem.detail
    : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

/**
 * Directory (`/dashboard/users`) and applicant queue (`/dashboard/applicants`)
 * list screen. Filter/sort/page state lives in the URL's `searchParams` so
 * a refresh or a Back/Forward navigation reproduces the same screen — see
 * `admin-access-url-state.ts` for the parse/serialize contract. Sort is
 * always resolved by the server contract; this screen never re-sorts
 * already-fetched rows.
 */
export function AdminAccessScreen({
  workspace,
}: {
  readonly workspace: AccessWorkspace;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isQueue = workspace === 'queue';
  const defaults = isQueue
    ? APPLICANT_QUEUE_DEFAULT_FILTER_STATE
    : ADMIN_ACCESS_DEFAULT_FILTER_STATE;

  const state = useMemo(
    () =>
      isQueue
        ? parseApplicantQueueSearchParams(searchParams)
        : parseAdminAccessSearchParams(searchParams),
    [isQueue, searchParams],
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
      const search = (
        isQueue
          ? buildApplicantQueueSearchParams(next)
          : buildAdminAccessSearchParams(next)
      ).toString();
      router.push(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [isQueue, pathname, router],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = buildAdminAccessListParams(state);
      const result = isQueue
        ? await fetchAdminAccessRequests(params)
        : await fetchAdminAccessList(params);
      setItems(result.items);
      setTotal(result.total);
      setPendingCount(result.facets.pendingRequests.pending);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [isQueue, state]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetFilters = () => {
    committedQueryRef.current = defaults.query;
    setQueryInput(defaults.query);
    navigate(defaults);
  };

  return (
    <AdminAccessView
      workspace={workspace}
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
      onSortToggle={(field: AdminAccessSortField) => {
        const direction =
          state.sort === field && state.direction === 'asc' ? 'desc' : 'asc';
        navigate({ ...state, sort: field, direction, page: 1 });
      }}
      onPageChange={(nextPage) => navigate({ ...state, page: nextPage })}
      onRetry={() => void load()}
      onResetFilters={resetFilters}
      onRowClick={(item) =>
        router.push(accessDetailPath(workspace, item.id), {
          scroll: false,
        })
      }
    />
  );
}
