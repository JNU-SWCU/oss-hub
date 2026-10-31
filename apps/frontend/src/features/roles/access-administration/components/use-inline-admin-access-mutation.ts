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
  const phase = useRef<'idle' | 'pending' | 'processing'>('idle');
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
    if (phase.current !== 'idle' || !controller || controller.signal.aborted)
      return;
    phase.current = 'pending';
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
        phase.current = 'idle';
        setConflictNotice(conflictMessage);
        onChanged();
        return;
      }
      setPending({ action, detail, returnFocusTo });
    } catch (error) {
      if (controller.signal.aborted) return;
      phase.current = 'idle';
      setActionError(adminAccessMutationErrorMessage(error));
    } finally {
      if (!controller.signal.aborted) setOpeningUserId(null);
    }
  };

  const cancel = () => {
    if (phase.current === 'processing') return;
    phase.current = 'idle';
    setPending(null);
    setDialogError(null);
  };

  const confirm = async (fields?: MemberKindMutationFields) => {
    const controller = lifetime.current;
    if (
      !pending ||
      phase.current === 'processing' ||
      !controller ||
      controller.signal.aborted
    )
      return;
    phase.current = 'processing';
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
      if (outcome.kind !== 'error') {
        phase.current = 'idle';
        setPending(null);
      }
      switch (outcome.kind) {
        case 'success':
          setSuccessMessage(
            adminAccessMutationSuccessMessage(action, detail.githubLogin),
          );
          break;
        case 'conflict':
          setConflictNotice(conflictMessage);
          break;
        case 'error':
          setDialogError(outcome.message);
          break;
      }
      onChanged();
    } finally {
      if (!controller.signal.aborted) {
        if (phase.current === 'processing') phase.current = 'pending';
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
