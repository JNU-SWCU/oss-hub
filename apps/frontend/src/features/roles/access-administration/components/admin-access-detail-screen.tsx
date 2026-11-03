'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminAccessDetailData } from '../admin-access-detail-api';
import { adminAccessDetailKey, invalidateAdminAccess } from '../queries';
import type { AccessWorkspace } from '../admin-access-list-query';
import {
  adminAccessMutationSuccessMessage,
  applyAdminAccessConflictProjection,
  applyAdminAccessDecidedRequestToHistory,
  isIndependentAuthorityMutationAction,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import { runAdminAccessMutation } from '../admin-access-mutation-outcome';
import type { CanonicalAdminAccessDetail } from '../independent-authority-api';
import { useAdminAccessDetailState } from './use-admin-access-detail-state';
import { AdminAccessDetailContentForState } from './admin-access-detail-content';
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
  const { state, retry, historyLoading, historyError, changeHistoryPage } =
    useAdminAccessDetailState(userId);

  const [confirmation, setConfirmation] = useState<{
    readonly action: AdminAccessMutationAction;
    readonly detail: CanonicalAdminAccessDetail;
  } | null>(null);
  const confirmAction = confirmation?.action ?? null;
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
    setConfirmation(null);
    setRejectReason('');
    setDialogError(null);
  };

  const confirmMutation = async () => {
    if (state.kind !== 'ready' || !confirmation) return;
    const { action, detail } = confirmation;
    setProcessingAction(action);
    setDialogError(null);
    setSuccessMessage(null);
    try {
      const outcome = await runAdminAccessMutation({
        userId,
        action,
        detail,
        reason: rejectReason,
      });
      if (outcome.kind === 'success') {
        const { result } = outcome;
        setConfirmation(null);
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
      } else if (outcome.kind === 'conflict') {
        const { projection } = outcome;
        if (!projection) {
          setConfirmation(null);
          setRejectReason('');
          setDialogError(null);
          setSuccessMessage(null);
          setConflictNotice(
            '다른 처리자가 먼저 변경했습니다. 최신 정보로 갱신했으니 다시 확인한 뒤 진행해 주세요.',
          );
          await invalidateAdminAccess(client, userId);
          return;
        }
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
        setConfirmation(null);
        setRejectReason('');
        setSuccessMessage(null);
        setConflictNotice(
          '다른 처리자가 먼저 변경했습니다. 최신 정보로 갱신했으니 다시 확인한 뒤 진행해 주세요.',
        );
      } else {
        setDialogError(outcome.message);
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
      if (state.kind !== 'ready') return;
      setConfirmation({ action, detail: state.detail });
      setRejectReason('');
      setDialogError(null);
      setConflictNotice(null);
      setSuccessMessage(null);
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
      historyError={historyError}
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
