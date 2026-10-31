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
import { adminAccessMutationDialogCopy } from './admin-access-detail-mutation';
import type { AdminAccessInlineActions } from './admin-access-inline-actions';
import { AdminAccessMutationConfirmDialog } from './admin-access-mutation-confirm-dialog';
import { AdminAccessView } from './admin-access-view';
import { useInlineAdminAccessMutation } from './use-inline-admin-access-mutation';

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.problem.detail
    : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

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
  const latestRequestId = useRef(0);

  const committedQueryRef = useRef(state.query);
  useEffect(() => {
    if (state.query !== committedQueryRef.current) {
      committedQueryRef.current = state.query;
      setQueryInput(state.query);
    }
  }, [state.query]);

  const listSearch = searchParams.toString();

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

  const load = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++latestRequestId.current;
    if (!quiet) setIsLoading(true);
    setError(null);
    try {
      const params = buildAdminAccessListParams(state);
      const result = isQueue
        ? await fetchAdminAccessRequests(params)
        : await fetchAdminAccessList(params);
      if (requestId !== latestRequestId.current) return;
      if (quiet && result.items.length === 0 && state.page > 1) {
        navigate({ ...state, page: state.page - 1 });
        return;
      }
      setItems(result.items);
      setTotal(result.total);
      setPendingCount(result.facets.pendingRequests.pending);
    } catch (loadError) {
      if (requestId !== latestRequestId.current) return;
      setError(errorMessage(loadError));
    } finally {
      if (!quiet && requestId === latestRequestId.current) setIsLoading(false);
    }
  }, [isQueue, navigate, state]);

  useEffect(() => {
    void load();
    return () => {
      latestRequestId.current += 1;
    };
  }, [load]);

  const latestLoad = useRef(load);
  useEffect(() => {
    latestLoad.current = load;
  }, [load]);
  const inline = useInlineAdminAccessMutation(() => {
    void latestLoad.current({ quiet: true });
  });
  const inlineActions: AdminAccessInlineActions = {
    onRequestAction: (item, action) => void inline.request(item, action),
    successMessage: inline.successMessage,
    conflictNotice: inline.conflictNotice,
    actionError: inline.actionError,
  };
  const pendingDialog = inline.pending
    ? {
        ...inline.pending,
        ...adminAccessMutationDialogCopy(
          inline.pending.action,
          inline.pending.detail,
        ),
      }
    : null;

  const resetFilters = () => {
    committedQueryRef.current = defaults.query;
    setQueryInput(defaults.query);
    navigate(defaults);
  };

  return (
    <>
      <AdminAccessView
        workspace={workspace}
        listSearch={listSearch}
        inlineActions={inlineActions}
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
          router.push(accessDetailPath(workspace, item.id, listSearch), {
            scroll: false,
          })
        }
      />
      {pendingDialog ? (
        <AdminAccessMutationConfirmDialog
          key={`${pendingDialog.detail.id}-${pendingDialog.action}`}
          action={pendingDialog.action}
          title={pendingDialog.title}
          description={pendingDialog.description}
          confirmLabel={pendingDialog.confirmLabel}
          destructive={pendingDialog.destructive}
          isProcessing={inline.isProcessing}
          errorMessage={inline.dialogError}
          profile={pendingDialog.detail.profile}
          onCancel={inline.cancel}
          onConfirm={(fields) => void inline.confirm(fields)}
        />
      ) : null}
    </>
  );
}
