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
          // 제목은 고정하고 본문만 스크롤한다. 예전에는 창 전체가 스크롤 상자여서
          // 마지막 줄(취소·제출하기)이 함께 밀려 올라갔고, 1280×800 같은 흔한 화면에서는
          // 창이 열린 순간 「제출하기」가 보이는 영역보다 200px 아래에 있었다. macOS의
          // 겹침 스크롤막대는 스크롤하기 전까지 보이지 않아 더 내려갈 수 있다는 신호도
          // 없다 — 눌렀다고 생각한 자리가 빈 곳이면 아무 일도 일어나지 않는다.
          className="fixed top-1/2 left-1/2 z-50 grid max-h-[min(90dvh,52rem)] w-[calc(100%_-_2rem)] max-w-[46rem] min-w-0 -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-background shadow-lg outline-none"
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
          <header className="grid gap-1 p-5 pr-14 sm:p-6 sm:pr-16">
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
          <div
            data-testid="submission-dialog-body"
            className="min-w-0 overflow-x-hidden overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6 *:min-w-0"
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
