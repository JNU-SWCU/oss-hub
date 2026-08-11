'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** 드로어 dialog 요소의 DOM id — 토글 버튼의 `aria-controls`가 이 값을 가리킨다. */
export const SIDEBAR_DRAWER_DIALOG_ID = 'app-sidebar-drawer';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SidebarDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly label: string;
  readonly children: ReactNode;
}

/**
 * 900px 미만 전용 오버레이 드로어 — 햄버거로 여는 데스크톱 사이드바의 모바일 대체.
 * 메뉴 콘텐츠(그룹·아이콘·current 마커)는 부모가 `children`으로 주입한다
 * (`AppSidebarNav`/`ProgramScopeSidebarNav` 재사용, `product-shell.tsx` 배선).
 * 여기서는 dialog 접근성 규약만 책임진다:
 * - role="dialog" + aria-modal + aria-label
 * - 열릴 때 첫 포커서블로 포커스, 닫힐 때 열기 전 포커스(트리거)로 복귀
 * - Tab 포커스 트랩
 * - Escape로 닫힘
 * - 배경 스크롤 잠금
 */
export function SidebarDrawer({
  open,
  onClose,
  label,
  children,
}: SidebarDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // 열기 전 포커스를 기억해 둔다 — 보통 트리거(햄버거) 버튼이라, 별도 ref 없이
    // 닫힐 때 그대로 복귀시키면 된다.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR,
        ) ?? [],
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
          <p className="font-heading text-[15px] font-bold tracking-[-0.02em] text-sidebar-foreground">
            {label}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="사이드바 메뉴 닫기"
            className="flex size-control items-center justify-center rounded-control text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
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
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
