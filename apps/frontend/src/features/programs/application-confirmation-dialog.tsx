import { useState, type ReactNode, type RefObject } from 'react';
import { AlertDialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
 * 신청과 신청 전 팀 관리가 사용하는 동일한 확인 레이어.
 *
 * `onClose`는 사용자가 직접 닫은 경우(취소/Escape/오버레이)에만 한 번 호출한다.
 * 부모가 이 컴포넌트를 언마운트해서 닫히는 경우에는 호출하지 않는다. Radix
 * FocusScope는 언마운트 정리를 매크로태스크로 미루기 때문에, 언마운트 시점에
 * `onCloseAutoFocus`에서 `onClose`를 부르면 이미 새로 열린 다이얼로그를 닫아
 * 버린다(QA: 실패한 신청 재시도 확인창 소실). `onCloseAutoFocus`는 포커스 복원만
 * 담당한다.
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
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || submitting) return;
        setOpen(false);
        onClose();
      }}
    >
      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
      <AlertDialog.Content
        onEscapeKeyDown={(event) => {
          if (submitting) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none"
      >
        <Card className="shadow-xl">
          <CardHeader>
            <AlertDialog.Title asChild>
              <CardTitle className="break-keep">{title}</CardTitle>
            </AlertDialog.Title>
          </CardHeader>
          <CardContent className="space-y-5">
            <AlertDialog.Description className="text-small leading-6 text-muted-foreground break-keep">
              {description}
            </AlertDialog.Description>
            {children}
            <div className="flex flex-wrap justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button type="button" variant="outline" disabled={submitting}>
                  취소
                </Button>
              </AlertDialog.Cancel>
              <Button
                type="button"
                variant={destructive ? 'destructive' : 'default'}
                disabled={submitting}
                onClick={onConfirm}
              >
                {submitting ? '처리 중…' : confirmLabel}
              </Button>
            </div>
          </CardContent>
        </Card>
      </AlertDialog.Content>
    </AlertDialog.Root>
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
