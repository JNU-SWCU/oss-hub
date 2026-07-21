import { Button } from '@/components/ui/button';

import type { StaffRoleRequest } from '../types';

interface StaffRequestRevokeDialogProps {
  readonly request: StaffRoleRequest;
  readonly isProcessing: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function StaffRequestRevokeDialog({
  request,
  isProcessing,
  onCancel,
  onConfirm,
}: StaffRequestRevokeDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-revoke-title"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2 id="staff-revoke-title" className="font-heading text-xl font-bold">
          교직원 역할 회수
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {request.githubLogin}님의 교직원 역할을 회수합니다. 회수하면 교직원
          권한이 즉시 제거됩니다.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isProcessing}
          >
            회수 확정
          </Button>
        </div>
      </div>
    </div>
  );
}
