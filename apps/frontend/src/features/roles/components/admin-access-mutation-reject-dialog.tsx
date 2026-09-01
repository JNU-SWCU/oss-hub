import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface AdminAccessMutationRejectDialogProps {
  readonly githubLogin: string;
  readonly reason: string;
  readonly isProcessing: boolean;
  readonly errorMessage: string | null;
  readonly onReasonChange: (reason: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/** Reject is the only `/dashboard/users` action needing an extra reason field. */
export function AdminAccessMutationRejectDialog({
  githubLogin,
  reason,
  isProcessing,
  errorMessage,
  onReasonChange,
  onCancel,
  onConfirm,
}: AdminAccessMutationRejectDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-access-reject-title"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2
          id="admin-access-reject-title"
          className="font-heading text-xl font-bold"
        >
          요청 반려
        </h2>
        <p className="mt-2 break-keep text-sm text-muted-foreground">
          {githubLogin}님의 교직원 권한 요청을 반려합니다.
        </p>
        <label
          htmlFor="admin-access-reject-reason"
          className="mt-5 block text-sm font-medium"
        >
          거절 사유
        </label>
        {/* 관리자가 무엇을 쓰는지 알고 쓰게 한다(#673). 이 값은 신청자의 역할 선택
            화면에 뜬다 — 예전에는 어디에도 표시되지 않아, 필수 입력이면서 아무도 읽지
            않는 칸이었다. 표시된다는 사실을 모르면 내부 메모처럼 쓰게 된다.

            ⚠ **"그대로"라고 쓰지 마라.** 표시 쪽이 제어문자를 지우고 줄 수를 줄이고
            길이를 자른다(`role-selection-screen.tsx`의 `clampRejectionReason`).
            "그대로"라고 적으면 관리자는 긴 사유를 끝까지 읽힐 것으로 믿고 쓰는데
            신청자는 앞부분만 본다 — 안내가 사실과 다르면 안내가 없느니만 못하다. */}
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
          className="mt-2 min-h-28 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {errorMessage ? (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
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
            disabled={isProcessing || reason.trim().length === 0}
          >
            반려 확정
          </Button>
        </div>
      </div>
    </div>
  );
}
