'use client';

import { useEffect, useRef, useState } from 'react';

import { runAdminAccessMutation } from '../admin-access-mutation-outcome';
import {
  adminAccessMutationErrorMessage,
  adminAccessMutationSuccessMessage,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import {
  fetchCanonicalAdminAccessDetail,
  type AdminAccessDirectoryItem,
  type CanonicalAdminAccessDetail,
  type MemberKindMutationFields,
} from '../independent-authority-api';

export type InlineAdminAccessMutationAction = Exclude<
  AdminAccessMutationAction,
  'APPROVE' | 'REJECT'
>;

const conflictMessage =
  '다른 처리자가 먼저 변경했습니다. 최신 정보로 갱신했으니 다시 확인한 뒤 진행해 주세요.';

export function useInlineAdminAccessMutation(onChanged: () => void) {
  const [pending, setPending] = useState<{
    readonly action: InlineAdminAccessMutationAction;
    readonly detail: CanonicalAdminAccessDetail;
    readonly returnFocusTo: HTMLElement | null;
  } | null>(null);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const busy = useRef(false);
  const processing = useRef(false);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const request = async (
    item: AdminAccessDirectoryItem,
    action: InlineAdminAccessMutationAction,
    returnFocusTo: HTMLElement | null,
  ) => {
    const controller = lifetime.current;
    if (busy.current || !controller || controller.signal.aborted) return;
    busy.current = true;
    setOpeningUserId(item.id);
    setDialogError(null);
    setConflictNotice(null);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const detail = await fetchCanonicalAdminAccessDetail(
        item.id,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (
        detail.memberKind !== item.memberKind ||
        detail.hasAdminAccess !== item.hasAdminAccess ||
        detail.accountStatus !== item.accountStatus ||
        detail.pendingRequest?.id !== item.pendingRequest?.id
      ) {
        busy.current = false;
        setConflictNotice(conflictMessage);
        onChanged();
        return;
      }
      setPending({ action, detail, returnFocusTo });
    } catch (error) {
      if (controller.signal.aborted) return;
      busy.current = false;
      setActionError(adminAccessMutationErrorMessage(error));
    } finally {
      if (!controller.signal.aborted) setOpeningUserId(null);
    }
  };

  const cancel = () => {
    if (processing.current) return;
    busy.current = false;
    setPending(null);
    setDialogError(null);
  };

  const confirm = async (fields?: MemberKindMutationFields) => {
    const controller = lifetime.current;
    if (
      !pending ||
      processing.current ||
      !controller ||
      controller.signal.aborted
    )
      return;
    processing.current = true;
    setIsProcessing(true);
    setDialogError(null);
    const { action, detail } = pending;
    try {
      const outcome = await runAdminAccessMutation({
        userId: detail.id,
        action,
        detail,
        reason: '',
        memberKindFields: fields,
      });
      if (controller.signal.aborted) return;
      switch (outcome.kind) {
        case 'success':
          busy.current = false;
          setPending(null);
          setSuccessMessage(
            adminAccessMutationSuccessMessage(action, detail.githubLogin),
          );
          break;
        case 'conflict':
          busy.current = false;
          setPending(null);
          setConflictNotice(conflictMessage);
          break;
        case 'error':
          setDialogError(outcome.message);
          break;
      }
      onChanged();
    } finally {
      if (!controller.signal.aborted) {
        processing.current = false;
        setIsProcessing(false);
      }
    }
  };

  return {
    pending,
    openingUserId,
    isProcessing,
    dialogError,
    conflictNotice,
    actionError,
    successMessage,
    request,
    cancel,
    confirm,
  };
}
