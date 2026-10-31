'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import type {
  ProgramScopeSidebarGroup,
  ProgramScopeSidebarItem,
} from './sidebar-menu';
import { ScopeSidebarLink } from './program-scope-sidebar-link';
import {
  SidebarScopeRow,
  SidebarShell,
  type SidebarShellVariant,
} from './sidebar-shell';

export interface ProgramScopeSidebarProps {
  readonly programName: string;

  readonly programNamePending?: boolean;

  readonly countsPending?: boolean;
  readonly groups: readonly ProgramScopeSidebarGroup[];
  readonly pathname: string;
  readonly search: string;
  readonly collapsed: boolean;
  readonly backHref: string;

  readonly bottom?: ReactNode;

  readonly variant?: SidebarShellVariant;
}

export function ProgramScopeSidebar({
  programName,
  programNamePending = false,
  countsPending = false,
  groups,
  pathname,
  search,
  collapsed,
  backHref,
  bottom,
  variant = 'aside',
}: ProgramScopeSidebarProps) {
  return (
    <SidebarShell
      kind="program-scope-sidebar"
      variant={variant}
      collapsed={collapsed}
      bottom={bottom}
      scope={
        <SidebarScopeRow
          backHref={backHref}
          backLabel="프로그램 목록"
          title={programName}
          titlePending={programNamePending}
          collapsed={collapsed}
        />
      }
      nav={
        <ProgramScopeSidebarNav
          groups={groups}
          pathname={pathname}
          search={search}
          collapsed={collapsed}
          ariaLabel={programName}
          countsPending={countsPending}
        />
      }
    />
  );
}

interface ProgramScopeSidebarNavProps {
  readonly groups: readonly ProgramScopeSidebarGroup[];
  readonly pathname: string;
  readonly search: string;
  readonly collapsed: boolean;
  readonly ariaLabel: string;

  readonly countsPending?: boolean;
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
  nextSearch.delete('view');
  const milestoneId = new URLSearchParams(targetSearch).get('milestoneId');
  if (milestoneId === null) nextSearch.delete('milestoneId');
  else nextSearch.set('milestoneId', milestoneId);

  const query = nextSearch.toString();
  return `${targetPath}${query ? `?${query}` : ''}`;
}

function ProgramScopeSidebarNav({
  groups,
  pathname,
  search,
  collapsed,
  ariaLabel,
  countsPending = false,
}: ProgramScopeSidebarNavProps) {
  const currentSearch = new URLSearchParams(search);
  const milestoneId = currentSearch.get('milestoneId');
  const requestedQuery = new URLSearchParams();
  if (milestoneId !== null) requestedQuery.set('milestoneId', milestoneId);
  const requestedHref = `${pathname}${requestedQuery.size > 0 ? `?${requestedQuery.toString()}` : ''}`;
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
                countPending={countsPending}
              />
            ))}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  );
}
