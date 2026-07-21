import { Button } from '@/components/ui/button';

import type { StaffRoleRequest } from '../types';

interface StaffRequestRejectDialogProps {
  readonly request: StaffRoleRequest;
  readonly reason: string;
  readonly isProcessing: boolean;
  readonly onReasonChange: (reason: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function StaffRequestRejectDialog({
  request,
  reason,
  isProcessing,
  onReasonChange,
  onCancel,
  onConfirm,
}: StaffRequestRejectDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-reject-title"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2 id="staff-reject-title" className="font-heading text-xl font-bold">
          교직원 요청 반려
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {request.githubLogin}님의 요청을 반려합니다.
        </p>
        <label
          htmlFor="staff-reject-reason"
          className="mt-5 block text-sm font-medium"
        >
          거절 사유
        </label>
        <textarea
          id="staff-reject-reason"
          required
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          disabled={isProcessing}
          className="mt-2 min-h-28 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isProcessing || reason.trim().length === 0}
          >
            반려 확정
          </Button>
        </div>
      </div>
    </div>
  );
}
