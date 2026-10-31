'use client';

import { useRef, type ReactNode } from 'react';
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

export const SIDEBAR_DRAWER_DIALOG_ID = 'app-sidebar-drawer';

export interface SidebarDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly label: string;
  readonly children: ReactNode;
}

export function SidebarDrawer({
  open,
  onClose,
  label,
  children,
}: SidebarDrawerProps) {
  const openerRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay
          data-slot="sidebar-drawer-backdrop"
          className="bg-overlay backdrop-blur-none shell:hidden"
        />
        <DialogPrimitive.Content
          id={SIDEBAR_DRAWER_DIALOG_ID}
          data-slot="sidebar-drawer"
          aria-modal="true"
          aria-label={label}
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            openerRef.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            openerRef.current?.focus();
          }}
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-sidebar-drawer flex-col',
            'border-r border-sidebar-border bg-sidebar outline-none shell:hidden',
          )}
        >
          <DialogTitle className="sr-only">{label}</DialogTitle>
          <div className="flex h-topbar shrink-0 items-center justify-end border-b border-sidebar-border px-4">
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="사이드바 메뉴 닫기"
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
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
