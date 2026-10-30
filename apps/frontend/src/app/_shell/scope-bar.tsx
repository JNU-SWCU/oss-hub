'use client';

import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { SHELL_MENU_SHEET_ID } from './shell-menu-sheet';
import { SidebarScopeRow } from './sidebar-shell';

export type ScopeBarScope =
  | {
      readonly kind: 'program';
      readonly backHref: string;
      readonly title: string;
      readonly titlePending?: boolean;
    }
  | { readonly kind: 'dashboard'; readonly title: string };

export interface ScopeBarProps {
  readonly scope: ScopeBarScope;

  readonly menuLabel: string;
  readonly sheetOpen: boolean;
  readonly onOpenSheet: () => void;

  readonly triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function ScopeBar({
  scope,
  menuLabel,
  sheetOpen,
  onOpenSheet,
  triggerRef,
}: ScopeBarProps) {
  return (
    <div
      data-slot="scope-bar"
      data-scope={scope.kind}
      data-breakpoint-visibility="mobile"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-background py-2 pr-2 shell:hidden"
    >
      <div className="min-w-0 flex-1">
        {scope.kind === 'program' ? (
          <SidebarScopeRow
            backHref={scope.backHref}
            backLabel="프로그램 목록"
            title={scope.title}
            titlePending={scope.titlePending}
            collapsed={false}
          />
        ) : (
          <p
            data-slot="scope-bar-title"
            className="truncate px-3 font-heading text-small font-semibold text-sidebar-foreground"
          >
            {scope.title}
          </p>
        )}
      </div>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        data-slot="scope-bar-menu-trigger"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        aria-controls={SHELL_MENU_SHEET_ID}
        onClick={onOpenSheet}
        className="max-w-1/2 shrink-0 text-sidebar-foreground"
      >
        <span className="truncate">{menuLabel}</span>
        <span aria-hidden>▾</span>
      </Button>
    </div>
  );
}
