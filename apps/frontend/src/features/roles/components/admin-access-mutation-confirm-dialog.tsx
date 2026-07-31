import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import type { AdminAccessMutationAction } from '../admin-access-mutation-policy';

interface AdminAccessMutationConfirmDialogProps {
  readonly action: AdminAccessMutationAction;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly destructive: boolean;
  readonly isProcessing: boolean;
  readonly errorMessage: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/**
 * Shared confirm-only dialog for the five `/admin/access` write actions
 * that need no extra input (approve/direct grant/revoke/deactivate/
 * reactivate) — `REJECT` alone needs a reason field and gets its own
 * `AdminAccessMutationRejectDialog`. Matches the plain fixed-overlay
 * `role="dialog"` pattern this feature has used since PR04G rather than
 * introducing a new primitive; five near-identical copies of that markup
 * would just be duplication, not the same "existing per-action dialog"
 * pattern.
 */
export function AdminAccessMutationConfirmDialog({
  action,
  title,
  description,
  confirmLabel,
  destructive,
  isProcessing,
  errorMessage,
  onCancel,
  onConfirm,
}: AdminAccessMutationConfirmDialogProps) {
  const titleId = `admin-access-mutation-title-${action}`;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2 id={titleId} className="font-heading text-xl font-bold">
          {title}
        </h2>
        <p className="mt-2 break-keep text-sm text-muted-foreground">
          {description}
        </p>
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
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isProcessing}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
