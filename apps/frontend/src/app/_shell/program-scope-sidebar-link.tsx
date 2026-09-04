'use client';

import Link from 'next/link';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ShellIcon } from './shell-icons';
import {
  PROGRAM_SCOPE_LOCKED_BADGE,
  type ProgramScopeSidebarItem,
} from './sidebar-menu';

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
  const locked = item.locked === true;
  // 상위 화면의 current와 그 안에서 고른 마일스톤의 selected는 서로 다른 상태다.
  // 정확한 pathname만 current로 두어 프로그램 개요가 모든 하위 경로에서 강조되는
  // prefix 오탐을 막는다.
  //
  // 잠긴 항목도 current가 될 수 있다 — 주소를 직접 입력해 그 화면에 들어와 있을 때다.
  // 그 자리에서 좌측 패널이 "어디에 있는지"를 감추면 사용자는 위치를 잃는다.
  const current = depth === 0 && pathname === item.href;
  // 잠긴 항목의 뱃지 자리는 카운트가 아니라 잠금 문구가 쓴다(sidebar-menu.ts가 이미
  // count를 비운다). 두 값이 같은 자리를 두고 다투지 않게 여기서 하나로 접는다.
  const badge = locked ? PROGRAM_SCOPE_LOCKED_BADGE : item.count;
  const showBadge = !collapsed && badge !== undefined;
  const collapsedLabel = `${item.label}${
    badge === undefined ? '' : ` ${badge}`
  }${selected ? ' 선택됨' : ''}`;

  const rowClassName = cn(
    'group relative flex h-control shrink-0 items-center rounded-control text-[15px] whitespace-nowrap text-muted-foreground transition-colors',
    locked
      ? 'cursor-not-allowed'
      : 'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
    current &&
      'bg-sidebar-current font-semibold text-sidebar-current-foreground',
    selected && 'bg-sidebar-accent font-semibold text-sidebar-foreground',
    collapsed
      ? 'w-control justify-center px-0'
      : depth === 1
        ? 'gap-3 py-0 pr-3 pl-9 text-[14px]'
        : 'gap-3 px-3',
  );

  const rowBody = (
    <>
      {current ? (
        <span
          aria-hidden
          data-slot="program-scope-sidebar-current-marker"
          className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sidebar-current-marker"
        />
      ) : null}
      {depth === 0 || collapsed ? <ShellIcon name={item.icon} /> : null}
      {/*
        접힌 레일에서 링크는 `aria-label`로 이름을 갖지만 잠긴 항목은 링크가 아니라
        이름 없는 요소다 — 라벨을 `hidden`(display:none)으로 지우면 읽어 주는 도구에
        아무 흔적이 남지 않는다. 그래서 잠금만 `sr-only`로 자리를 비우고 글자는 남긴다.
      */}
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          collapsed && (locked ? 'sr-only' : 'hidden'),
        )}
      >
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
      {locked ? (
        <span
          data-slot="program-scope-sidebar-lock"
          className={cn(
            'ml-auto inline-flex shrink-0 items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground',
            collapsed && 'sr-only',
          )}
        >
          {PROGRAM_SCOPE_LOCKED_BADGE}
        </span>
      ) : showBadge ? (
        <span
          data-slot="program-scope-sidebar-count"
          className={cn(
            'ml-auto inline-flex shrink-0 items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground',
            current &&
              'bg-primary-foreground/15 text-sidebar-current-foreground',
          )}
        >
          {badge}
        </span>
      ) : null}
    </>
  );

  /*
    잠긴 항목은 링크가 아니다 — `href`를 그대로 두면 눌러서 403을 만나는 동선이
    남고 그것이 이 결함(#1099)이었다. 목록에는 그대로 두되 누를 수 없는 자리로 그린다.
  */
  const row = locked ? (
    <span
      data-slot="program-scope-sidebar-locked"
      aria-disabled="true"
      aria-current={current ? 'page' : undefined}
      data-current={current ? 'true' : undefined}
      data-depth={depth}
      data-icon={depth === 0 || collapsed ? item.icon : undefined}
      className={rowClassName}
    >
      {rowBody}
    </span>
  ) : (
    <Link
      href={href}
      scroll={depth === 1 ? false : undefined}
      aria-current={current ? 'page' : undefined}
      aria-label={collapsed ? collapsedLabel : undefined}
      data-current={current ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-depth={depth}
      data-icon={depth === 0 || collapsed ? item.icon : undefined}
      className={rowClassName}
    >
      {rowBody}
    </Link>
  );

  if (!collapsed) return row;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" data-slot="program-scope-sidebar-tooltip">
        {collapsedLabel}
      </TooltipContent>
    </Tooltip>
  );
}
