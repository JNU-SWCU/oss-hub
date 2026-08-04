'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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

/** 사이드바 카운트 표시: 99 초과는 `99+`. */
export function formatSidebarCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

const YEAR_LABEL_RE = /^\d{4}$/;
const YEAR_HREF_RE = /[?&]year=\d{4}\b/;

/**
 * 접힌 레일에서 아이콘 아래 표시할 메트릭.
 * - count 있으면 포맷된 숫자
 * - 랭킹 연도처럼 count 없는 연도 항목은 라벨(연도)로 구분 (M1)
 */
function collapsedMetric(
  item: SidebarGroup['items'][number],
): { text: string; isCount: boolean } | null {
  if (item.count !== undefined) {
    return { text: formatSidebarCount(item.count), isCount: true };
  }
  if (YEAR_LABEL_RE.test(item.label) || YEAR_HREF_RE.test(item.href)) {
    return { text: item.label, isCount: false };
  }
  return null;
}

function linkAriaLabel(
  item: SidebarGroup['items'][number],
  collapsed: boolean,
): string | undefined {
  if (!collapsed) return undefined;
  return item.count !== undefined
    ? `${item.label} ${item.count}`
    : item.label;
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
  onToggle,
}: AppSidebarProps) {
  const title = groups[0]?.label ?? '메뉴';
  const toggleLabel = collapsed ? '사이드바 펼치기' : '사이드바 접기';

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
        {!collapsed ? (
          <p className="font-heading text-[15px] font-bold tracking-[-0.02em] text-sidebar-foreground">
            {title}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          className={cn(
            'flex size-control items-center justify-center rounded-control text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
            !collapsed &&
              'ml-auto border border-sidebar-border text-muted-foreground hover:text-sidebar-foreground',
          )}
        >
          <ShellIcon
            name="chevronLeft"
            className={cn(
              'size-[18px] shrink-0 transition-transform',
              collapsed && 'rotate-180',
            )}
          />
        </button>
      </div>

      <TooltipProvider delayDuration={200}>
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
      </TooltipProvider>

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
  const metric = collapsed ? collapsedMetric(item) : null;
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
        'group relative flex shrink-0 rounded-control text-[15px] whitespace-nowrap text-muted-foreground transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
        current &&
          'bg-sidebar-current font-semibold text-sidebar-current-foreground',
        collapsed
          ? 'h-auto w-control flex-col items-center justify-center gap-0.5 px-0 py-1.5'
          : 'h-control items-center gap-3 px-3',
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
      {!collapsed && showCount ? (
        <span
          data-slot="app-sidebar-count"
          className={cn(
            'ml-auto inline-flex shrink-0 items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground',
            current &&
              'bg-primary-foreground/15 text-sidebar-current-foreground',
          )}
        >
          {formatSidebarCount(item.count as number)}
        </span>
      ) : null}
      {collapsed && metric ? (
        <span
          data-slot={metric.isCount ? 'app-sidebar-count' : undefined}
          className={cn(
            'text-xs font-semibold tabular-nums',
            current
              ? 'text-sidebar-current-foreground'
              : 'text-muted-foreground',
          )}
        >
          {metric.text}
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
