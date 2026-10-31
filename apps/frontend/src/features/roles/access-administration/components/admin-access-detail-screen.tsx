'use client';

import { useEffect, useState } from 'react';
import {
  skipToken,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import {
  fetchAdminAccessHistory,
  parseAdminAccessConflictProjection,
  type AdminAccessHistory,
  type AdminAccessHistoryParams,
} from '../admin-access-api';
import {
  ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
  AdminAccessDetailNotFoundError,
  type AdminAccessDetailData,
} from '../admin-access-detail-api';
import {
  adminAccessDetailKey,
  adminAccessHistoryKey,
  invalidateAdminAccess,
  useAdminAccessDetailQuery,
} from '../queries';
import type { AccessWorkspace } from '../admin-access-list-query';
import { executeAdminAccessMutation } from '../admin-access-mutation-execution';
import {
  adminAccessMutationErrorMessage,
  adminAccessMutationSuccessMessage,
  applyAdminAccessConflictProjection,
  applyAdminAccessDecidedRequestToHistory,
  isIndependentAuthorityMutationAction,
  isMemberKindMutationAction,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import type { MemberKindMutationFields } from '../independent-authority-api';
import {
  AdminAccessDetailContentForState,
  type AdminAccessDetailState,
} from './admin-access-detail-content';
import type { AdminAccessDetailLayoutContext } from './admin-access-detail-layout';
import type { AdminAccessDetailMutationController } from './admin-access-detail-mutation';

function AdminAccessDetailScreenForUser({
  userId,
  layoutContext = 'standalone',
  workspace = 'directory',
}: {
  readonly userId: string;
  readonly layoutContext?: AdminAccessDetailLayoutContext;
  readonly workspace?: AccessWorkspace;
}) {
  const client = useQueryClient();
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

  const [confirmAction, setConfirmAction] =
    useState<AdminAccessMutationAction | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processingAction, setProcessingAction] =
    useState<AdminAccessMutationAction | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const cancelAction = () => {
    setConfirmAction(null);
    setRejectReason('');
    setDialogError(null);
  };

  const confirmMutation = async (
    memberKindFields?: MemberKindMutationFields,
  ) => {
    if (state.kind !== 'ready' || !confirmAction) return;
    const action = confirmAction;
    const detail = state.detail;
    setProcessingAction(action);
    setDialogError(null);
    setSuccessMessage(null);
    try {
      const result = isMemberKindMutationAction(action)
        ? await executeAdminAccessMutation(
            userId,
            action,
            detail,
            rejectReason,
            memberKindFields,
          )
        : await executeAdminAccessMutation(
            userId,
            action,
            detail,
            rejectReason,
          );
      setConfirmAction(null);
      setRejectReason('');
      setConflictNotice(null);
      setSuccessMessage(
        adminAccessMutationSuccessMessage(action, detail.githubLogin),
      );

      if (workspace === 'queue' && result) {
        client.setQueryData<AdminAccessDetailData>(
          adminAccessDetailKey(userId),
          (current) =>
            current
              ? {
                  detail: applyAdminAccessConflictProjection(
                    current.detail,
                    result,
                  ),
                  history: applyAdminAccessDecidedRequestToHistory(
                    current.history,
                    result.decidedRequest,
                  ),
                }
              : current,
        );
        await invalidateAdminAccess(client, userId, false);
      } else {
        await invalidateAdminAccess(client, userId);
      }
    } catch (error) {
      if (
        isMemberKindMutationAction(action) &&
        error instanceof ApiError &&
        error.problem.status === 409
      ) {
        setConfirmAction(null);
        setRejectReason('');
        setDialogError(null);
        setSuccessMessage(null);
        setConflictNotice(
          '다른 처리자가 먼저 변경했습니다. 최신 정보로 갱신했으니 다시 확인한 뒤 진행해 주세요.',
        );
        await invalidateAdminAccess(client, userId);
        return;
      }
      const projection = parseAdminAccessConflictProjection(error);
      if (projection) {
        if (isIndependentAuthorityMutationAction(action)) {
          await invalidateAdminAccess(client, userId);
        } else {
          client.setQueryData<AdminAccessDetailData>(
            adminAccessDetailKey(userId),
            {
              detail: applyAdminAccessConflictProjection(detail, projection),
              history: state.history,
            },
          );
          await invalidateAdminAccess(client, userId, false);
        }
        setConfirmAction(null);
        setRejectReason('');
        setSuccessMessage(null);
        setConflictNotice(
          '다른 처리자가 먼저 변경했습니다. 최신 정보로 갱신했으니 다시 확인한 뒤 진행해 주세요.',
        );
      } else {
        setDialogError(adminAccessMutationErrorMessage(error));
      }
    } finally {
      setProcessingAction(null);
    }
  };

  const mutation: AdminAccessDetailMutationController = {
    confirmAction,
    processingAction,
    rejectReason,
    dialogError,
    conflictNotice,
    successMessage,
    onRequestAction(action) {
      setConfirmAction(action);
      setRejectReason('');
      setDialogError(null);
      setConflictNotice(null);
      setSuccessMessage(null);
    },
    onCancel: cancelAction,
    onConfirm: (fields) => void confirmMutation(fields),
    onReasonChange: setRejectReason,
  };

  const handleProfileSaved = () => {
    if (state.kind === 'ready') {
      setSuccessMessage(
        `${state.detail.githubLogin}님의 프로필을 저장했습니다.`,
      );
    }
    void invalidateAdminAccess(client, userId);
  };

  return (
    <AdminAccessDetailContentForState
      state={state}
      onRetry={retry}
      mutation={mutation}
      layoutContext={layoutContext}
      workspace={workspace}
      historyLoading={historyLoading}
      historyError={
        historyFailure
          ? {
              message: `${historyFailure.kind === 'login' ? '로그인' : '요청'} 이력을 불러오지 못했습니다. 이전 목록은 그대로 남아 있습니다.`,
              onRetry: () => void historyQuery.refetch(),
            }
          : null
      }
      onStaffAccessRequestPageChange={(page) =>
        void changeHistoryPage('staffAccessRequest', page)
      }
      onLoginHistoryPageChange={(page) => void changeHistoryPage('login', page)}
      onProfileSaved={handleProfileSaved}
    />
  );
}

export function AdminAccessDetailScreen(
  props: Parameters<typeof AdminAccessDetailScreenForUser>[0],
) {
  return <AdminAccessDetailScreenForUser key={props.userId} {...props} />;
}
