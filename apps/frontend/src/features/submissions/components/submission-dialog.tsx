'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';

export function SubmissionDialog({
  title,
  description,
  onClose,
  returnFocusId,
  busy = false,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly onClose: () => void;
  readonly returnFocusId: string;
  readonly busy?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-50 grid max-h-[min(90dvh,52rem)] w-[calc(100%_-_2rem)] max-w-[46rem] min-w-0 -translate-x-1/2 -translate-y-1/2 gap-5 overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-background p-5 shadow-lg outline-none *:min-w-0 sm:p-6"
          onCloseAutoFocus={(event) => {
            const returnTarget = document.getElementById(returnFocusId);
            if (!(returnTarget instanceof HTMLElement)) return;
            event.preventDefault();
            returnTarget.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <header className="grid gap-1 pr-10">
            <DialogPrimitive.Title className="font-heading text-xl font-semibold">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm break-keep text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          </header>
          <DialogPrimitive.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4"
              aria-label="제출 창 닫기"
              disabled={busy}
            >
              <X aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
