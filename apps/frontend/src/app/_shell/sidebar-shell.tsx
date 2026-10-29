'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { SkeletonBlock } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ShellIcon } from './shell-icons';

export const SIDEBAR_ASIDE_ID = 'app-sidebar-aside';

export type SidebarShellKind = 'app-sidebar' | 'program-scope-sidebar';

export type SidebarShellVariant = 'aside' | 'drawer';

const FOOT_SLOT: Readonly<Record<SidebarShellKind, string>> = {
  'app-sidebar': 'app-sidebar-foot',
  'program-scope-sidebar': 'program-scope-sidebar-foot',
};

export interface SidebarShellProps {
  readonly kind: SidebarShellKind;

  readonly variant?: SidebarShellVariant;
  readonly collapsed: boolean;
  readonly nav: ReactNode;

  readonly scope?: ReactNode;

  readonly bottom?: ReactNode;
}

export function SidebarShell({
  kind,
  variant = 'aside',
  collapsed,
  nav,
  scope,
  bottom,
}: SidebarShellProps) {
  const body = (
    <>
      {scope ? (
        <div
          data-slot="sidebar-shell-scope"
          className={cn(
            'shrink-0 px-3 pt-3',
            collapsed && 'flex justify-center px-2',
          )}
        >
          {scope}
        </div>
      ) : null}
      {nav}
      {collapsed ? null : bottom}
      {collapsed ? null : (
        <p
          data-slot={FOOT_SLOT[kind]}
          className="mt-auto shrink-0 p-4 text-small whitespace-nowrap text-muted-foreground"
        >
          전남대학교
          <br />
          SW중심대학사업단
        </p>
      )}
    </>
  );

  if (variant === 'drawer') {
    return (
      <div
        data-slot="sidebar-shell"
        data-variant="drawer"
        data-kind={kind}
        data-collapsed={collapsed ? 'true' : 'false'}
        className="flex h-full min-h-0 flex-col bg-sidebar"
      >
        {body}
      </div>
    );
  }

  return (
    <aside
      id={SIDEBAR_ASIDE_ID}
      data-slot={kind}
      data-variant="aside"
      data-breakpoint-visibility="desktop"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'hidden shell:flex shell:h-full shell:min-h-0 shell:flex-col shell:overflow-hidden',
        'border-sidebar-border bg-sidebar shell:border-r',
      )}
    >
      {body}
    </aside>
  );
}

export function SidebarCountSkeleton() {
  return (
    <span
      aria-hidden
      data-slot="sidebar-count-skeleton"
      className={cn(
        'ml-auto inline-flex shrink-0 items-center rounded-md border border-transparent bg-secondary px-2 py-0.5',
        'animate-pulse text-badge font-semibold text-transparent tabular-nums motion-reduce:animate-none',
      )}
    >
      00
    </span>
  );
}

export function SidebarBottomSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="sidebar-bottom-skeleton"
      className="mx-3 shrink-0 border-t border-sidebar-border px-1 py-4"
    >
      <div className="text-xs">
        <SkeletonBlock className="h-lh w-12 rounded-sm" />
      </div>
      <div className="text-section">
        <SkeletonBlock className="h-lh w-24 rounded-sm" />
      </div>
      <div className="text-xs">
        <SkeletonBlock className="h-lh w-20 rounded-sm" />
      </div>
      <div className="mt-3 text-xs">
        <SkeletonBlock className="h-lh w-16 rounded-sm" />
      </div>
      <div className="mt-1 text-section">
        <SkeletonBlock className="h-lh w-full rounded-sm" />
      </div>
    </div>
  );
}

export interface SidebarScopeRowProps {
  readonly backHref: string;
  readonly backLabel: string;
  readonly title: string;

  readonly titlePending?: boolean;
  readonly collapsed: boolean;
}

export function SidebarScopeRow({
  backHref,
  backLabel,
  title,
  titlePending = false,
  collapsed,
}: SidebarScopeRowProps) {
  if (collapsed) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={backHref}
              aria-label={backLabel}
              data-slot="sidebar-shell-back"
              className={cn(
                'flex h-control w-control shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors',
                'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
              )}
            >
              <ShellIcon name="chevronLeft" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" data-slot="sidebar-shell-tooltip">
            {backLabel}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3">
      <Link
        href={backHref}
        data-slot="sidebar-shell-back"
        className="self-start text-badge font-bold whitespace-nowrap text-primary hover:underline"
      >
        {`‹ ${backLabel}`}
      </Link>
      {titlePending ? (
        <div
          aria-hidden
          data-slot="sidebar-scope-title-skeleton"
          className="font-heading text-small font-semibold"
        >
          <SkeletonBlock className="h-lh w-3/4 rounded-sm" />
        </div>
      ) : (
        <p
          data-slot="sidebar-shell-scope-title"
          className="truncate font-heading text-small font-semibold text-sidebar-foreground"
        >
          {title}
        </p>
      )}
    </div>
  );
}
