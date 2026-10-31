'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { ApiError } from '@/lib/api-client';

import { useAdminAccessListQuery } from '../queries';
import type { AdminAccessSortField } from '../admin-access-api';
import {
  ADMIN_ACCESS_DEFAULT_FILTER_STATE,
  ADMIN_ACCESS_LIST_LIMIT,
  APPLICANT_QUEUE_DEFAULT_FILTER_STATE,
  accessDetailPath,
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

  const query = useAdminAccessListQuery(workspace, state);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pendingCount = query.data?.facets.pendingRequests.pending ?? 0;
  const [queryInput, setQueryInput] = useState(state.query);
  const [isRetrying, setIsRetrying] = useState(false);
  const isLoading = query.isPending || isRetrying;
  const error = query.isError ? errorMessage(query.error) : null;

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

  const latestList = useRef({ state, refetch: query.refetch, navigate });
  useEffect(() => {
    latestList.current = { state, refetch: query.refetch, navigate };
  }, [state, query.refetch, navigate]);

  const inline = useInlineAdminAccessMutation(() => {
    const list = latestList.current;
    void list.refetch().then((result) => {
      if (
        latestList.current.state === list.state &&
        result.isSuccess &&
        result.data.items.length === 0 &&
        list.state.page > 1
      ) {
        list.navigate({ ...list.state, page: list.state.page - 1 });
      }
    });
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
        onRetry={() => {
          setIsRetrying(true);
          void query.refetch().finally(() => setIsRetrying(false));
        }}
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
