'use client';

import { useRef } from 'react';

import { DialogShell } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AdminAccessMutationRejectDialogProps {
  readonly githubLogin: string;
  readonly reason: string;
  readonly isProcessing: boolean;
  readonly errorMessage: string | null;
  readonly onReasonChange: (reason: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function AdminAccessMutationRejectDialog({
  githubLogin,
  reason,
  isProcessing,
  errorMessage,
  onReasonChange,
  onCancel,
  onConfirm,
}: AdminAccessMutationRejectDialogProps) {
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  return (
    <DialogShell
      kind="alert"
      title="요청 반려"
      description={`${githubLogin}님의 교직원 권한 요청을 반려합니다.`}
      busy={isProcessing}
      returnFocusRef={returnFocusRef}
      className="max-w-md break-keep [overflow-wrap:anywhere]"
      onCancel={onCancel}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isProcessing}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isProcessing || reason.trim().length === 0}
          >
            반려 확정
          </Button>
        </>
      }
    >
      <div>
        <label
          htmlFor="admin-access-reject-reason"
          className="block text-sm font-medium"
        >
          반려 사유
        </label>

        <p
          id="admin-access-reject-reason-hint"
          className="mt-1 break-keep text-xs text-muted-foreground"
        >
          입력한 사유는 신청자에게 표시됩니다. 너무 길면 앞부분만 보이니 핵심을
          먼저 적어 주세요.
        </p>
        <textarea
          id="admin-access-reject-reason"
          required
          aria-describedby="admin-access-reject-reason-hint"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          disabled={isProcessing}
          className={cn(
            'mt-2 min-h-28 w-full rounded-lg border border-input bg-transparent px-3 py-2',
            'text-sm outline-none focus-visible:border-ring focus-visible:ring-3',
            'focus-visible:ring-ring/50',
          )}
        />
        {errorMessage ? (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </DialogShell>
  );
}
