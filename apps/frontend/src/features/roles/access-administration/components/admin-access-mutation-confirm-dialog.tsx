'use client';
import { useRef } from 'react';
import { DialogShell } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
interface AdminAccessMutationConfirmDialogProps {
  readonly title: string;
  readonly description?: string | null;
  readonly confirmLabel: string;
  readonly destructive: boolean;
  readonly isProcessing: boolean;
  readonly errorMessage: string | null;

  readonly returnFocusTo?: HTMLElement | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function AdminAccessMutationConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive,
  isProcessing,
  errorMessage,
  returnFocusTo,
  onCancel,
  onConfirm,
}: AdminAccessMutationConfirmDialogProps) {
  const returnFocusRef = useRef<HTMLElement | null>(
    returnFocusTo ?? getCurrentFocusTarget(),
  );
  return (
    <DialogShell
      title={title}
      description={description}
      busy={isProcessing}
      returnFocusRef={returnFocusRef}
      onCancel={() => {
        if (!isProcessing) onCancel();
      }}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={isProcessing}
            onClick={onCancel}
          >
            취소
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={isProcessing}
            onClick={() => {
              if (!isProcessing) onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </DialogShell>
  );
}
function getCurrentFocusTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && activeElement !== document.body
    ? activeElement
    : null;
}
