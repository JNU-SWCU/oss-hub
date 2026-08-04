'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ShellIcon } from './shell-icons';
import { isCurrentSidebarItem, type SidebarGroup } from './sidebar-menu';

/**
 * 왼쪽 사이드 패널 — 상단에서 고른 섹션의 하위 네비.
 * 그룹 라벨이 제목. 프로그램 자식 항목은 depth=1 들여쓰기.
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
      className="flex flex-col border-b border-sidebar-border bg-sidebar min-[900px]:sticky min-[900px]:top-0 min-[900px]:max-h-[calc(100dvh-3.5rem)] min-[900px]:min-h-[calc(100dvh-3.5rem)] min-[900px]:border-r min-[900px]:border-b-0"
    >
      <div
        data-slot="app-sidebar-brand"
        className={cn(
          'flex h-topbar shrink-0 items-center gap-3 border-b border-sidebar-border px-4',
          collapsed && 'min-[900px]:justify-center min-[900px]:px-0',
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
              className="ml-auto hidden size-control items-center justify-center rounded-control border border-sidebar-border text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none min-[900px]:flex"
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
          'flex gap-1 overflow-x-auto p-3 min-[900px]:flex-col min-[900px]:gap-0.5 min-[900px]:overflow-x-visible',
          collapsed && 'min-[900px]:items-center min-[900px]:px-2',
        )}
      >
        {groups.map((group) => {
          const parents = group.items.filter((i) => (i.depth ?? 0) === 0);
          const children = group.items.filter((i) => (i.depth ?? 0) === 1);
          // 평평한 그룹(depth 없는 역할 메뉴)은 전부 depth 0으로 취급
          const flat =
            children.length === 0
              ? group.items
              : parents.length > 0
                ? parents
                : group.items;

          return (
            <div
              key={group.label}
              role="group"
              aria-label={group.label}
              data-slot="app-sidebar-group"
              className="flex shrink-0 gap-1 min-[900px]:w-full min-[900px]:flex-col min-[900px]:gap-0.5"
            >
              {flat.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  search={search}
                  collapsed={collapsed}
                />
              ))}
              {children.length > 0 ? (
                <div
                  data-slot="app-sidebar-depth-children"
                  className={cn(
                    'flex shrink-0 gap-1 min-[900px]:ml-3 min-[900px]:flex-col min-[900px]:gap-0.5 min-[900px]:border-l min-[900px]:border-sidebar-border min-[900px]:pl-3',
                    collapsed && 'min-[900px]:ml-0 min-[900px]:border-l-0 min-[900px]:pl-0',
                  )}
                >
                  {children.map((item) => (
                    <SidebarLink
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      search={search}
                      collapsed={collapsed}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <p
        data-slot="app-sidebar-foot"
        className={cn(
          'mt-auto hidden border-t border-sidebar-border p-4 text-small whitespace-nowrap text-muted-foreground',
          !collapsed && 'min-[900px]:block',
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
      className={cn(
        'group relative flex h-control shrink-0 items-center gap-3 rounded-control px-3 text-[15px] whitespace-nowrap text-muted-foreground transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
        current &&
          'bg-sidebar-current font-semibold text-sidebar-current-foreground',
        collapsed &&
          'min-[900px]:w-control min-[900px]:justify-center min-[900px]:px-0',
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
      <span className={cn('min-w-0 flex-1 truncate', collapsed && 'min-[900px]:hidden')}>
        {item.label}
      </span>
      {showCount ? (
        <span
          data-slot="app-sidebar-count"
          className={cn(
            'ml-auto inline-flex shrink-0 items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground',
            collapsed && 'min-[900px]:hidden',
            current && 'bg-primary-foreground/15 text-sidebar-current-foreground',
          )}
        >
          {item.count}
        </span>
      ) : null}
      {collapsed ? (
        <span
          data-slot="app-sidebar-tooltip"
          className="pointer-events-none absolute top-1/2 left-full z-30 ml-2.5 hidden -translate-y-1/2 rounded-control bg-foreground px-2.5 py-1.5 text-xs font-medium text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 min-[900px]:block"
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
