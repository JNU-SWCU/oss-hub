'use client';

import { useRef, type ReactNode, type RefObject } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useCurrentItemInView } from './sidebar-shell';

export const SHELL_MENU_SHEET_ID = 'shell-menu-sheet';

export interface ShellMenuSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;

  readonly title: string;

  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
}

export function ShellMenuSheet({
  open,
  onClose,
  title,
  returnFocusRef,
  children,
}: ShellMenuSheetProps) {
  const openerRef = useRef<HTMLElement | null>(null);
  const bodyRef = useCurrentItemInView<HTMLDivElement>();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay
          data-slot="shell-menu-sheet-backdrop"
          className="bg-overlay backdrop-blur-none shell:hidden"
        />
        <DialogPrimitive.Content
          id={SHELL_MENU_SHEET_ID}
          data-slot="shell-menu-sheet"
          aria-modal="true"
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            openerRef.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (returnFocusRef?.current ?? openerRef.current)?.focus();
          }}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-sheet-max flex-col rounded-t-card',
            'border-t border-sidebar-border bg-sidebar pb-safe-bottom shadow-lg outline-none shell:hidden',
          )}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <div className="flex shrink-0 items-center px-2 pt-2">
            <span className="flex-1" />
            <span
              aria-hidden
              data-slot="shell-menu-sheet-grabber"
              className="h-1 w-10 shrink-0 rounded-full bg-border"
            />
            <span className="flex flex-1 justify-end">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="메뉴 닫기"
                  className={cn(
                    'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent dark:hover:text-sidebar-foreground',
                    'focus-visible:ring-sidebar-ring',
                  )}
                >
                  <svg
                    aria-hidden
                    focusable="false"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    strokeLinecap="round"
                    className="size-sidebar-icon"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </Button>
              </DialogClose>
            </span>
          </div>
          <div
            ref={bodyRef}
            data-slot="shell-menu-sheet-body"
            className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
