'use client';

import Link from 'next/link';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ShellIcon } from './shell-icons';
import type { ProgramScopeSidebarItem } from './sidebar-menu';

interface ScopeSidebarLinkProps {
  readonly item: ProgramScopeSidebarItem;
  readonly href: string;
  readonly pathname: string;
  readonly collapsed: boolean;
  readonly selected: boolean;
}

export function ScopeSidebarLink({
  item,
  href,
  pathname,
  collapsed,
  selected,
}: ScopeSidebarLinkProps) {
  const depth = item.depth ?? 0;
  // 상위 화면의 current와 그 안에서 고른 마일스톤의 selected는 서로 다른 상태다.
  // 정확한 pathname만 current로 두어 프로그램 개요가 모든 하위 경로에서 강조되는
  // prefix 오탐을 막는다.
  const current = depth === 0 && pathname === item.href;
  const showCount = !collapsed && item.count !== undefined;
  const collapsedLabel = `${item.label}${
    item.count === undefined ? '' : ` ${item.count}`
  }${selected ? ' 선택됨' : ''}`;

  const link = (
    <Link
      href={href}
      scroll={depth === 1 ? false : undefined}
      aria-current={current ? 'page' : undefined}
      aria-label={collapsed ? collapsedLabel : undefined}
      data-current={current ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-depth={depth}
      data-icon={depth === 0 || collapsed ? item.icon : undefined}
      className={cn(
        'group relative flex h-control shrink-0 items-center rounded-control text-[15px] whitespace-nowrap text-muted-foreground transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
        current &&
          'bg-sidebar-current font-semibold text-sidebar-current-foreground',
        selected && 'bg-sidebar-accent font-semibold text-sidebar-foreground',
        collapsed
          ? 'w-control justify-center px-0'
          : depth === 1
            ? 'gap-3 py-0 pr-3 pl-9 text-[14px]'
            : 'gap-3 px-3',
      )}
    >
      {current ? (
        <span
          aria-hidden
          data-slot="program-scope-sidebar-current-marker"
          className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sidebar-current-marker"
        />
      ) : null}
      {depth === 0 || collapsed ? <ShellIcon name={item.icon} /> : null}
      <span className={cn('min-w-0 flex-1 truncate', collapsed && 'hidden')}>
        {item.label}
      </span>
      {!collapsed && selected ? (
        <span
          data-slot="program-scope-sidebar-selection"
          className="shrink-0 text-xs font-semibold text-primary"
        >
          선택됨
        </span>
      ) : null}
      {showCount ? (
        <span
          data-slot="program-scope-sidebar-count"
          className={cn(
            'ml-auto inline-flex shrink-0 items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground',
            current &&
              'bg-primary-foreground/15 text-sidebar-current-foreground',
          )}
        >
          {item.count}
        </span>
      ) : null}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" data-slot="program-scope-sidebar-tooltip">
        {collapsedLabel}
      </TooltipContent>
    </Tooltip>
  );
}
