'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const SIDEBAR_DRAWER_DIALOG_ID = 'app-sidebar-drawer';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ??
          [],
      );
    focusables()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-slot="sidebar-drawer-root"
      className="fixed inset-0 z-50 min-[900px]:hidden"
    >
      <div
        data-slot="sidebar-drawer-backdrop"
        aria-hidden="true"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        id={SIDEBAR_DRAWER_DIALOG_ID}
        data-slot="sidebar-drawer"
        className={cn(
          'border-sidebar-border bg-sidebar relative flex h-full w-[min(85vw,320px)] flex-col border-r',
        )}
      >
        <div className="flex h-topbar shrink-0 items-center justify-between gap-3 border-b border-sidebar-border px-4">
          <p className="font-heading text-table font-bold tracking-[-0.02em] text-sidebar-foreground">
            {label}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
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
              className="size-[18px]"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
