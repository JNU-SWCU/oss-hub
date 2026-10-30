'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ShellIcon } from './shell-icons';
import { isCurrentSidebarItem, type SidebarGroup } from './sidebar-menu';
import {
  SidebarCountSkeleton,
  SidebarShell,
  type SidebarShellVariant,
} from './sidebar-shell';

interface AppSidebarProps {
  readonly groups: readonly SidebarGroup[];
  readonly pathname: string;
  readonly search?: string;
  readonly collapsed: boolean;

  readonly brandTitle?: string;

  readonly bottom?: ReactNode;

  readonly countsPending?: boolean;

  readonly variant?: SidebarShellVariant;
}

export function formatSidebarCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

function linkAriaLabel(
  item: SidebarGroup['items'][number],
  collapsed: boolean,
): string | undefined {
  if (!collapsed) return undefined;
  return item.count !== undefined ? `${item.label} ${item.count}` : item.label;
}

function tooltipText(item: SidebarGroup['items'][number]): string {
  return item.count !== undefined
    ? `${item.label} ${formatSidebarCount(item.count)}`
    : item.label;
}

export function AppSidebar({
  groups,
  pathname,
  search = '',
  collapsed,
  brandTitle,
  bottom,
  countsPending = false,
  variant = 'aside',
}: AppSidebarProps) {
  const title = brandTitle ?? groups[0]?.label ?? '메뉴';

  return (
    <SidebarShell
      kind="app-sidebar"
      variant={variant}
      collapsed={collapsed}
      bottom={bottom}
      nav={
        <AppSidebarNav
          groups={groups}
          pathname={pathname}
          search={search}
          collapsed={collapsed}
          brandTitle={title}
          countsPending={countsPending}
        />
      }
    />
  );
}

export interface AppSidebarNavProps {
  readonly groups: readonly SidebarGroup[];
  readonly pathname: string;
  readonly search?: string;
  readonly collapsed: boolean;
  readonly brandTitle?: string;

  readonly countsPending?: boolean;
}

export function AppSidebarNav({
  groups,
  pathname,
  search = '',
  collapsed,
  brandTitle,
  countsPending = false,
}: AppSidebarNavProps) {
  const title = brandTitle ?? groups[0]?.label ?? '메뉴';
  const showGroupLabels = !collapsed;

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        data-slot="app-sidebar-nav"
        aria-label={title}
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto p-3',
          groups.length > 1 ? 'gap-4' : 'gap-0.5',
          collapsed && 'items-center px-2',
        )}
      >
        {groups.map((group) => (
          <div
            key={group.label}
            role="group"
            aria-label={group.label}
            data-slot="app-sidebar-group"
            className={cn(
              'flex w-full flex-col gap-0.5',
              collapsed && 'items-center',
            )}
          >
            {showGroupLabels && group.label !== title ? (
              <p
                data-slot="app-sidebar-group-label"
                className="px-3 pt-1 text-xs font-semibold tracking-wide text-muted-foreground"
              >
                {group.label}
              </p>
            ) : null}
            {group.items.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                pathname={pathname}
                search={search}
                collapsed={collapsed}
                countPending={countsPending && item.count === undefined}
              />
            ))}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  );
}

function SidebarLink({
  item,
  pathname,
  search,
  collapsed,
  countPending,
}: {
  readonly item: SidebarGroup['items'][number];
  readonly pathname: string;
  readonly search: string;
  readonly collapsed: boolean;
  readonly countPending: boolean;
}) {
  const current = isCurrentSidebarItem(pathname, item.href, search);
  const showCount = !collapsed && item.count !== undefined;
  const ariaLabel = linkAriaLabel(item, collapsed);

  const link = (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      aria-label={ariaLabel}
      data-current={current ? 'true' : undefined}
      data-depth={item.depth ?? 0}
      data-icon={item.icon}
      className={cn(
        'group relative flex h-control shrink-0 items-center rounded-control text-table whitespace-nowrap text-muted-foreground transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
        current &&
          'bg-sidebar-current font-semibold text-sidebar-current-foreground',
        collapsed ? 'w-control justify-center px-0' : 'gap-3 px-3',
      )}
    >
      <ShellIcon name={item.icon} />
      <span className={cn('min-w-0 flex-1 truncate', collapsed && 'hidden')}>
        {item.label}
      </span>
      {!collapsed && countPending ? <SidebarCountSkeleton /> : null}
      {showCount ? (
        <span
          data-slot="app-sidebar-count"
          className={cn(
            'ml-auto inline-flex shrink-0 items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-badge font-semibold tabular-nums text-secondary-foreground',
            current &&
              'bg-primary-foreground/15 text-sidebar-current-foreground',
          )}
        >
          {formatSidebarCount(item.count)}
        </span>
      ) : null}
    </Link>
  );

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" data-slot="app-sidebar-tooltip">
        {tooltipText(item)}
      </TooltipContent>
    </Tooltip>
  );
}
