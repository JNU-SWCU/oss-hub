import { Button } from '@/components/ui/button';

import type { AdminUser, UserRole } from '../types';

interface AdminRoleChangeDialogProps {
  readonly user: AdminUser;
  readonly role: UserRole;
  readonly isProcessing: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

const ROLE_LABEL: Record<UserRole, string> = {
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '관리자',
};

export function AdminRoleChangeDialog({
  user,
  role,
  isProcessing,
  onCancel,
  onConfirm,
}: AdminRoleChangeDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-role-change-title"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2
          id="admin-role-change-title"
          className="font-heading text-xl font-bold"
        >
          역할 변경 확인
        </h2>
        <p className="mt-2 break-keep text-sm text-muted-foreground">
          {user.githubLogin}님의 역할을 {ROLE_LABEL[role]}(으)로 변경하면 기존
          권한이 즉시 해제됩니다.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            className="h-11"
            variant="outline"
            onClick={onCancel}
            disabled={isProcessing}
          >
            취소
          </Button>
          <Button
            className="h-11"
            variant="destructive"
            onClick={onConfirm}
            disabled={isProcessing}
          >
            변경 확정
          </Button>
        </div>
      </div>
    </div>
  );
}
