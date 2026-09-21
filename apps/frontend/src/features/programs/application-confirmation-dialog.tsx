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

/**
 * 신청과 신청 전 팀 관리가 사용하는 동일한 확인 레이어. 되돌릴 수 없는 일을 묻기 때문에
 * 공용 껍데기의 `kind="alert"`를 쓴다(R-06).
 *
 * `onClose`는 사용자가 직접 닫은 경우(취소/Escape)에만 한 번 호출한다. 부모가 이
 * 컴포넌트를 언마운트해서 닫히는 경우에는 호출하지 않는다. Radix FocusScope는 언마운트
 * 정리를 매크로태스크로 미루기 때문에, 언마운트 시점에 `onClose`를 부르면 이미 새로 열린
 * 다이얼로그를 닫아 버린다(QA: 실패한 신청 재시도 확인창 소실).
 *
 * 확정 버튼은 누른다고 창을 닫지 않는다 — 처리 중 표시와 실패 알림을 이 창 안에서
 * 보여 줘야 하므로 닫는 시점은 부모가 정한다. 취소 버튼만 스스로 닫는다(예전
 * `AlertDialog.Cancel`이 하던 일을 손으로 메운 자리다).
 */
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
      // 원래 폭(max-w-lg)을 유지한다 — 껍데기 기본값 md는 한 단계 넓다.
      className="max-w-lg"
      // 본문이 없을 때 빈 칸이 한 줄 더 생기지 않게 한다(설명 ↔ 버튼 줄 간격 유지).
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
          ? '신청서만 삭제되고 팀은 유지됩니다. 신청 기간 내에는 다시 제출할 수 있습니다.'
          : kind === 'save'
            ? '저장한 내용은 담당자의 신청 검토 화면에 즉시 반영됩니다.'
            : '신청서를 제출하면 담당자가 검토합니다. 신청 기간 내 승인 대기 상태에서는 신청서를 수정하거나 취소할 수 있지만, 승인된 이후에는 수정 및 취소가 불가능합니다.'
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
