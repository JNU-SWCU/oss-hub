'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  fetchAdminAccessHistory,
  parseAdminAccessConflictProjection,
} from '../admin-access-api';
import {
  ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
  AdminAccessDetailNotFoundError,
  loadAdminAccessDetail,
} from '../admin-access-detail-api';
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

export function AdminAccessDetailScreen({
  userId,
  layoutContext = 'standalone',
  workspace = 'directory',
}: {
  readonly userId: string;
  readonly layoutContext?: AdminAccessDetailLayoutContext;
  readonly workspace?: AccessWorkspace;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AdminAccessDetailState>({
    kind: 'loading',
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyRequestRef = useRef(0);
  const [historyFailure, setHistoryFailure] = useState<{
    readonly kind: 'staffAccessRequest' | 'login';
    readonly page: number;
  } | null>(null);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    historyRequestRef.current += 1;
    setHistoryLoading(false);
    setHistoryFailure(null);
    setState({ kind: 'loading' });
    void loadAdminAccessDetail(userId, controller.signal)
      .then((data) => {
        if (active) setState({ kind: 'ready', ...data });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(
          error instanceof AdminAccessDetailNotFoundError
            ? { kind: 'not-found' }
            : { kind: 'error' },
        );
      });
    return () => {
      active = false;
      historyRequestRef.current += 1;
      controller.abort();
    };
  }, [attempt, userId]);

  const changeHistoryPage = async (
    kind: 'staffAccessRequest' | 'login',
    nextPage: number,
  ) => {
    if (state.kind !== 'ready' || state.detail.id !== userId) return;
    const request = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryFailure(null);
    try {
      const history = await fetchAdminAccessHistory(userId, {
        staffAccessRequestPage:
          kind === 'staffAccessRequest'
            ? nextPage
            : state.history.staffAccessRequests.page,
        staffAccessRequestLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
        loginPage:
          kind === 'login' ? nextPage : state.history.loginHistory.page,
        loginLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
      });
      if (request !== historyRequestRef.current) return;
      setState((current) =>
        current.kind === 'ready' && current.detail.id === userId
          ? { ...current, history }
          : current,
      );
    } catch {
      if (request !== historyRequestRef.current) return;
      setHistoryFailure({ kind, page: nextPage });
    } finally {
      if (request === historyRequestRef.current) setHistoryLoading(false);
    }
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
    setConfirmAction(null);
    setRejectReason('');
    setProcessingAction(null);
    setDialogError(null);
    setConflictNotice(null);
    setSuccessMessage(null);
  }, [userId]);

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
        setState((current) =>
          current.kind === 'ready'
            ? {
                kind: 'ready',
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
      } else {
        retry();
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
        retry();
        return;
      }
      const projection = parseAdminAccessConflictProjection(error);
      if (projection) {
        if (isIndependentAuthorityMutationAction(action)) {
          retry();
        } else {
          setState({
            kind: 'ready',
            detail: applyAdminAccessConflictProjection(detail, projection),
            history: state.history,
          });
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
    retry();
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
              onRetry: () =>
                void changeHistoryPage(
                  historyFailure.kind,
                  historyFailure.page,
                ),
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
