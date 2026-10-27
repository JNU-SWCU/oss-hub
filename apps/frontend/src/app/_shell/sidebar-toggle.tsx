'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ShellIcon } from './shell-icons';
import { SIDEBAR_DRAWER_DIALOG_ID } from './sidebar-drawer';
import { useSidebarDrawer } from './sidebar-drawer-context';
import { SIDEBAR_ASIDE_ID } from './sidebar-shell';

const TOGGLE_CLASS = cn(
  'shrink-0 text-foreground/80 focus-visible:bg-muted focus-visible:text-foreground',
  'aria-expanded:bg-transparent aria-expanded:text-foreground/80',
);

export function SidebarToggle() {
  const shell = useSidebarDrawer();
  if (shell === null || !shell.sidebarAvailable) return null;

  const collapseLabel = shell.collapsed ? '사이드바 펼치기' : '사이드바 접기';

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-slot="nav-bar-sidebar-toggle"
        data-breakpoint-visibility="desktop"
        aria-label={collapseLabel}
        title={collapseLabel}
        aria-expanded={!shell.collapsed}
        aria-controls={SIDEBAR_ASIDE_ID}
        onClick={shell.toggleCollapsed}
        className={cn(TOGGLE_CLASS, 'hidden shell:inline-flex')}
      >
        <ShellIcon name="panelLeft" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-slot="nav-bar-sidebar-drawer-trigger"
        data-breakpoint-visibility="mobile"
        aria-label="사이드바 메뉴 열기"
        aria-expanded={shell.open}
        aria-controls={SIDEBAR_DRAWER_DIALOG_ID}
        onClick={shell.toggle}
        className={cn(TOGGLE_CLASS, 'shell:hidden')}
      >
        <ShellIcon name="panelLeft" />
      </Button>
    </>
  );
}
