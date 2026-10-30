'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ShellIcon } from './shell-icons';
import { SIDEBAR_KEY_SHORTCUTS, useShellMenu } from './shell-menu-context';
import { SIDEBAR_ASIDE_ID } from './sidebar-shell';

const TOGGLE_CLASS = cn(
  'shrink-0 text-foreground/80 focus-visible:bg-muted focus-visible:text-foreground',
  'aria-expanded:bg-transparent aria-expanded:text-foreground/80',
);

export function SidebarToggle() {
  const shell = useShellMenu();
  if (shell === null || !shell.sidebarAvailable) return null;

  const collapseLabel = shell.collapsed ? '사이드바 펼치기' : '사이드바 접기';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-slot="nav-bar-sidebar-toggle"
      data-breakpoint-visibility="desktop"
      aria-label={collapseLabel}
      aria-keyshortcuts={SIDEBAR_KEY_SHORTCUTS}
      title={`${collapseLabel} (⌘\\)`}
      aria-expanded={!shell.collapsed}
      aria-controls={SIDEBAR_ASIDE_ID}
      onClick={shell.toggleCollapsed}
      className={cn(TOGGLE_CLASS, 'hidden shell:inline-flex')}
    >
      <ShellIcon name="panelLeft" />
    </Button>
  );
}
