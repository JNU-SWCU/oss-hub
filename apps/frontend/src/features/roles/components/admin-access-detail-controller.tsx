'use client';

import { useCallback, useEffect, useState } from 'react';
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
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import {
  AdminAccessDetailContentForState,
  type AdminAccessDetailState,
} from './admin-access-detail-content';
import type { AdminAccessDetailLayoutContext } from './admin-access-detail-layout';
import type { AdminAccessDetailMutationController } from './admin-access-detail-mutation';

export function AdminAccessDetailView({
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
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
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
      controller.abort();
    };
  }, [attempt, userId]);

  const changeHistoryPage = async (
    kind: 'staffAccessRequest' | 'login',
    nextPage: number,
  ) => {
    if (state.kind !== 'ready') return;
    setHistoryLoading(true);
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
      setState((current) =>
        current.kind === 'ready' ? { ...current, history } : current,
      );
    } catch {
      // Keep the currently visible history page; the same control retries.
    } finally {
      setHistoryLoading(false);
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
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const cancelAction = () => {
    setConfirmAction(null);
    setRejectReason('');
    setDialogError(null);
  };

  const confirmMutation = async () => {
    if (state.kind !== 'ready' || !confirmAction) return;
    const action = confirmAction;
    const detail = state.detail;
    setProcessingAction(action);
    setDialogError(null);
    try {
      const result = await executeAdminAccessMutation(
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
      // 가입 신청(queue)은 결정과 동시에 대상을 볼 권한을 잃는다 — 백엔드
      // `requireVisibleTarget`은 관리자가 아닌 STAFF에게 "대기 요청이 살아
      // 있는 대상"만 열어 준다. 그래서 재조회 대신 PATCH가 돌려준 권위 있는
      // projection으로만 화면을 갱신한다. 명부(directory)는 결정 뒤에도 대상을
      // 읽을 수 있으므로 canonical 권한 플래그와 서버가 채운 감사 필드를 다시
      // 읽는다. 세션 역할이 아닌 workspace로 갈라야 한다 — 관리자도 가입 신청
      // 화면을 쓴다.
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
      const projection = parseAdminAccessConflictProjection(error);
      if (projection) {
        setState({
          kind: 'ready',
          detail: applyAdminAccessConflictProjection(detail, projection),
          history: state.history,
        });
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
    },
    onCancel: cancelAction,
    onConfirm: () => void confirmMutation(),
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
      onStaffAccessRequestPageChange={(page) =>
        void changeHistoryPage('staffAccessRequest', page)
      }
      onLoginHistoryPageChange={(page) => void changeHistoryPage('login', page)}
      onProfileSaved={handleProfileSaved}
    />
  );
}
