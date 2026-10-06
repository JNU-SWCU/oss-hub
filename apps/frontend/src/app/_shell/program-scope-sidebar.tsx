'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProgramCountdown } from '@/components';
import type { CountdownMilestone } from '@/components/program-countdown';
import { ShellIcon } from './shell-icons';
import type {
  ProgramScopeSidebarGroup,
  ProgramScopeSidebarItem,
} from './sidebar-menu';
import { ScopeSidebarLink } from './program-scope-sidebar-link';

export interface ProgramScopeSidebarProps {
  readonly programName: string;
  readonly groups: readonly ProgramScopeSidebarGroup[];
  readonly pathname: string;
  readonly search: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly backHref: string;

  readonly remainingMilestones?: readonly CountdownMilestone[];
}

export function ProgramScopeSidebar({
  programName,
  groups,
  pathname,
  search,
  collapsed,
  onToggle,
  backHref,
  remainingMilestones,
}: ProgramScopeSidebarProps) {
  const toggleLabel = collapsed ? '사이드바 펼치기' : '사이드바 접기';

  return (
    <aside
      data-slot="program-scope-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'hidden min-[900px]:flex min-[900px]:h-full min-[900px]:min-h-0 min-[900px]:flex-col min-[900px]:overflow-hidden',
        'border-sidebar-border bg-sidebar min-[900px]:border-r',
      )}
    >
      <div
        data-slot="program-scope-sidebar-brand"
        className={cn(
          'flex h-topbar shrink-0 items-center gap-3 border-b border-sidebar-border px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        {!collapsed ? (
          <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5">
            <Link
              href={backHref}
              className="text-xs font-bold tracking-[0.02em] whitespace-nowrap text-primary hover:underline"
            >
              ‹ 프로그램 목록
            </Link>
            <p className="w-full truncate font-heading text-small font-semibold tracking-[-0.01em] text-sidebar-foreground">
              {programName}
            </p>
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          className={cn(
            'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent dark:hover:text-sidebar-foreground focus-visible:ring-sidebar-ring aria-expanded:bg-transparent aria-expanded:hover:bg-sidebar-accent aria-expanded:hover:text-sidebar-foreground',
            !collapsed &&
              'ml-auto border-sidebar-border text-muted-foreground aria-expanded:text-muted-foreground',
          )}
        >
          <ShellIcon
            name="chevronLeft"
            className={cn(
              'size-[18px] shrink-0 transition-transform',
              collapsed && 'rotate-180',
            )}
          />
        </Button>
      </div>

      <ProgramScopeSidebarNav
        groups={groups}
        pathname={pathname}
        search={search}
        collapsed={collapsed}
        ariaLabel={programName}
      />

      {!collapsed && remainingMilestones !== undefined ? (
        <ProgramCountdown mode="program" milestones={remainingMilestones} />
      ) : null}

      <p
        data-slot="program-scope-sidebar-foot"
        className={cn(
          'mt-auto shrink-0 border-t border-sidebar-border p-4 text-small whitespace-nowrap text-muted-foreground',
          collapsed && 'hidden',
        )}
      >
        전남대학교
        <br />
        SW중심대학사업단
      </p>
    </aside>
  );
}

export interface ProgramScopeSidebarNavProps {
  readonly groups: readonly ProgramScopeSidebarGroup[];
  readonly pathname: string;
  readonly search: string;
  readonly collapsed: boolean;
  readonly ariaLabel: string;
}

function stageHrefWithCurrentQuery(
  item: ProgramScopeSidebarItem,
  pathname: string,
  search: string,
): string {
  if ((item.depth ?? 0) !== 1) return item.href;

  const [targetPath = item.href, targetSearch = ''] = item.href.split('?');
  if (targetPath !== pathname) return item.href;

  const nextSearch = new URLSearchParams(search);
  const milestoneId = new URLSearchParams(targetSearch).get('milestoneId');
  if (milestoneId === null) nextSearch.delete('milestoneId');
  else nextSearch.set('milestoneId', milestoneId);

  const query = nextSearch.toString();
  return `${targetPath}${query ? `?${query}` : ''}`;
}

export function ProgramScopeSidebarNav({
  groups,
  pathname,
  search,
  collapsed,
  ariaLabel,
}: ProgramScopeSidebarNavProps) {
  const milestoneId = new URLSearchParams(search).get('milestoneId');
  const requestedHref =
    milestoneId === null
      ? pathname
      : `${pathname}?milestoneId=${encodeURIComponent(milestoneId)}`;
  const hasRequestedStage = groups.some((group) =>
    group.items.some(
      (item) => (item.depth ?? 0) === 1 && item.href === requestedHref,
    ),
  );

  const focusedHref = hasRequestedStage ? requestedHref : pathname;

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        data-slot="program-scope-sidebar-nav"
        aria-label={ariaLabel}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3',
          collapsed && 'items-center px-2',
        )}
      >
        {groups.map((group) => (
          <div
            key={group.label}
            role="group"
            aria-label={group.label}
            data-slot="program-scope-sidebar-group"
            className={cn(
              'flex w-full flex-col gap-0.5',
              collapsed && 'items-center',
            )}
          >
            {group.items.map((item, itemIndex) => (
              <ScopeSidebarLink
                key={`${itemIndex}-${item.href}`}
                item={item}
                href={stageHrefWithCurrentQuery(item, pathname, search)}
                pathname={pathname}
                collapsed={collapsed}
                selected={(item.depth ?? 0) === 1 && item.href === focusedHref}
              />
            ))}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  );
}
