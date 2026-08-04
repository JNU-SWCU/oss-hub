'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ShellIcon } from './shell-icons';
import { isCurrentSidebarItem, type SidebarGroup } from './sidebar-menu';

/**
 * 데스크톱(≥900px) 전용 왼쪽 사이드 패널.
 * 모바일은 본문 칩/필터로 대체한다 — 가로 스크롤 아이콘 띠는 깨지기 쉽다.
 */
interface AppSidebarProps {
  readonly groups: readonly SidebarGroup[];
  readonly pathname: string;
  readonly search?: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}

export function AppSidebar({
  groups,
  pathname,
  search = '',
  collapsed,
  onToggle,
}: AppSidebarProps) {
  const title = groups[0]?.label ?? '메뉴';

  return (
    <aside
      data-slot="app-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        // 모바일: 숨김 — 필터는 페이지 칩이 담당
        'hidden min-[900px]:flex min-[900px]:flex-col',
        'border-sidebar-border bg-sidebar min-[900px]:sticky min-[900px]:top-0 min-[900px]:max-h-[calc(100dvh-3.5rem)] min-[900px]:min-h-[calc(100dvh-3.5rem)] min-[900px]:border-r',
      )}
    >
      <div
        data-slot="app-sidebar-brand"
        className={cn(
          'flex h-topbar shrink-0 items-center gap-3 border-b border-sidebar-border px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={false}
            aria-label="사이드바 펼치기"
            title="사이드바 펼치기"
            className="flex size-control items-center justify-center rounded-control text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
          >
            <BrandMark />
          </button>
        ) : (
          <>
            <p className="font-heading text-[15px] font-bold tracking-[-0.02em] text-sidebar-foreground">
              {title}
            </p>
            <button
              type="button"
              onClick={onToggle}
              aria-expanded
              aria-label="사이드바 접기"
              title="사이드바 접기"
              className="ml-auto flex size-control items-center justify-center rounded-control border border-sidebar-border text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
            >
              <ShellIcon name="chevronLeft" className="size-[18px] shrink-0" />
            </button>
          </>
        )}
      </div>

      <nav
        data-slot="app-sidebar-nav"
        aria-label={title}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3',
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
            {group.items.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                pathname={pathname}
                search={search}
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}
      </nav>

      <p
        data-slot="app-sidebar-foot"
        className={cn(
          'mt-auto border-t border-sidebar-border p-4 text-small whitespace-nowrap text-muted-foreground',
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

function SidebarLink({
  item,
  pathname,
  search,
  collapsed,
}: {
  readonly item: SidebarGroup['items'][number];
  readonly pathname: string;
  readonly search: string;
  readonly collapsed: boolean;
}) {
  const current = isCurrentSidebarItem(pathname, item.href, search);
  const showCount = item.count !== undefined;

  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      data-current={current ? 'true' : undefined}
      data-depth={item.depth ?? 0}
      data-icon={item.icon}
      className={cn(
        'group relative flex h-control shrink-0 items-center gap-3 rounded-control px-3 text-[15px] whitespace-nowrap text-muted-foreground transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
        current &&
          'bg-sidebar-current font-semibold text-sidebar-current-foreground',
        collapsed && 'w-control justify-center px-0',
      )}
    >
      {current ? (
        <span
          aria-hidden
          data-slot="app-sidebar-current-marker"
          className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sidebar-current-marker"
        />
      ) : null}
      <ShellIcon name={item.icon} />
      <span className={cn('min-w-0 flex-1 truncate', collapsed && 'hidden')}>
        {item.label}
      </span>
      {showCount ? (
        <span
          data-slot="app-sidebar-count"
          className={cn(
            'ml-auto inline-flex shrink-0 items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground',
            collapsed && 'hidden',
            current &&
              'bg-primary-foreground/15 text-sidebar-current-foreground',
          )}
        >
          {item.count}
        </span>
      ) : null}
      {collapsed ? (
        <span
          data-slot="app-sidebar-tooltip"
          className="pointer-events-none absolute top-1/2 left-full z-30 ml-2.5 -translate-y-1/2 rounded-control bg-foreground px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {item.label}
          {showCount ? ` (${item.count})` : ''}
        </span>
      ) : null}
    </Link>
  );
}

function BrandMark() {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-control bg-primary text-sm font-bold text-primary-foreground"
    >
      O
    </span>
  );
}
