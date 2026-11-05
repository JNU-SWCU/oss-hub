'use client';

import { useState, type ReactNode, type RefObject } from 'react';
import { DialogShell } from '@/components';
import { Button } from '@/components/ui/button';
import type { ApplicationConfirmation } from './program-apply-views';

export interface ApplicationActionDialogProps {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly children?: ReactNode;
}

export function ApplicationActionDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  submitting,
  onClose,
  onConfirm,
  returnFocusRef,
  children,
}: ApplicationActionDialogProps) {
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    onClose();
  };

  return (
    <DialogShell
      kind="alert"
      open={open}
      title={title}
      description={description}
      busy={submitting}
      returnFocusRef={returnFocusRef}

      className="max-w-lg"

      bodyClassName={children ? undefined : 'mt-0'}
      onCancel={close}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={close}
          >
            취소
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={submitting}
            onClick={onConfirm}
          >
            {submitting ? '처리 중…' : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </DialogShell>
  );
}

export function ApplicationConfirmationDialog({
  kind,
  ...props
}: {
  readonly kind: Exclude<ApplicationConfirmation, null>;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const isCancellation = kind === 'cancel';
  return (
    <ApplicationActionDialog
      {...props}
      title={
        isCancellation
          ? '신청을 취소하시겠습니까?'
          : kind === 'save'
            ? '수정 내용을 저장하시겠습니까?'
            : '신청서를 제출하시겠습니까?'
      }
      description={
        isCancellation
          ? '팀과 신청서가 함께 삭제됩니다. 구성원의 소속과 보낸 초대도 정리됩니다. 신청 기간 안에는 새 팀을 구성해 다시 신청할 수 있습니다.'
          : kind === 'save'
            ? '저장한 내용은 담당자의 신청 검토 화면에 즉시 반영됩니다.'
            : '신청서를 제출하면 담당자가 검토합니다. 신청 기간 내 검토 대기나 반려 상태에서는 신청서를 수정하거나 취소할 수 있지만, 승인된 이후에는 수정 및 취소가 불가능합니다.'
      }
      confirmLabel={
        isCancellation
          ? '신청 취소'
          : kind === 'save'
            ? '수정 내용 저장'
            : '신청서 제출'
      }
      destructive={isCancellation}
    />
  );
}
