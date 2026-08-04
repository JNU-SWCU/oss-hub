'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ProgramCountdown } from '@/features/programs/program-countdown';
import { ShellIcon } from './shell-icons';
import type {
  ProgramScopeSidebarGroup,
  ProgramScopeSidebarItem,
} from './sidebar-menu';

/**
 * 프로그램 상세(`/programs/:id` 하위) 전용 좌측 패널.
 * `AppSidebar`의 마크업·아이콘·current 마커(3px)·카운트 뱃지·접기 토글 규약을
 * 그대로 재사용한다(docs/design.md §업무 화면 내비게이션 › 프로그램 스코프 좌측 패널) — 다만 브랜드 행이 "‹ 프로그램 목록" 백링크 +
 * 프로그램명으로 바뀌고, 마감 카운트다운 블록이 하단(footer 위)에 추가된다.
 * `AppSidebar` 자체는 건드리지 않는다 — 두 컴포넌트는 완전히 별개다(SidebarItem.count는
 * 숫자 전용이라 이 화면의 분수 뱃지("2/6", "12/47팀")를 표현할 수 없다).
 */
export interface ProgramScopeSidebarProps {
  readonly programName: string;
  readonly groups: readonly ProgramScopeSidebarGroup[];
  readonly pathname: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  /** 기본 `/programs`. */
  readonly backHref?: string;
  /** 다음 마감 마일스톤 — 없으면(전부 지났으면) 카운트다운 블록 자체를 렌더하지 않는다. */
  readonly countdown?: {
    readonly nextMilestoneLabel: string;
    readonly dueAt: string;
  } | null;
}

export function ProgramScopeSidebar({
  programName,
  groups,
  pathname,
  collapsed,
  onToggle,
  backHref = '/programs',
  countdown = null,
}: ProgramScopeSidebarProps) {
  const toggleLabel = collapsed ? '사이드바 펼치기' : '사이드바 접기';

  return (
    <aside
      data-slot="program-scope-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'hidden min-[900px]:flex min-[900px]:flex-col',
        'border-sidebar-border bg-sidebar min-[900px]:sticky min-[900px]:top-0 min-[900px]:max-h-[calc(100dvh-3.5rem)] min-[900px]:min-h-[calc(100dvh-3.5rem)] min-[900px]:border-r',
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
            <p className="w-full truncate font-heading text-[13px] font-semibold tracking-[-0.01em] text-sidebar-foreground">
              {programName}
            </p>
          </div>
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
          data-slot="program-scope-sidebar-nav"
          aria-label={programName}
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
              {group.items.map((item) => (
                <ScopeSidebarLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  collapsed={collapsed}
                />
              ))}
            </div>
          ))}
        </nav>
      </TooltipProvider>

      {!collapsed && countdown ? (
        <ProgramCountdown
          nextMilestoneLabel={countdown.nextMilestoneLabel}
          dueAt={countdown.dueAt}
        />
      ) : null}

      <p
        data-slot="program-scope-sidebar-foot"
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

function ScopeSidebarLink({
  item,
  pathname,
  collapsed,
}: {
  readonly item: ProgramScopeSidebarItem;
  readonly pathname: string;
  readonly collapsed: boolean;
}) {
  const depth = item.depth ?? 0;
  // 정확히 일치할 때만 강조한다(prefix 매칭 없음) — 이 메뉴의 href들은 서로
  // 경로상 부모/자식 관계다(`/programs/:id`가 `/programs/:id/teams` 등의 리터럴
  // 접두어), `isCurrentSidebarItem`의 범용 prefix fallback을 그대로 쓰면 "프로그램
  // 개요"가 모든 하위 화면에서 함께 강조되는 오탐이 난다. 자식(마일스톤별 서류) 행은
  // 여러 href가 같은 화면(status/mydocs)으로 모이므로 애초에 current 마커를 달지
  // 않는다(프로토타입 계약 그대로 — docs/design.md §업무 화면 내비게이션 › 프로그램 스코프 좌측 패널, 학생 자식: "current 마커
  // 없이"). 쿼리 문자열은 비교에서 제외한다(pathname에 애초에 없다).
  const current = depth === 0 && pathname === item.href;
  const showCount = !collapsed && item.count !== undefined;
  const ariaLabel =
    collapsed && item.count !== undefined
      ? `${item.label} ${item.count}`
      : collapsed
        ? item.label
        : undefined;

  const link = (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      aria-label={ariaLabel}
      data-current={current ? 'true' : undefined}
      data-depth={depth}
      data-icon={depth === 0 || collapsed ? item.icon : undefined}
      className={cn(
        'group relative flex h-control shrink-0 items-center rounded-control text-[15px] whitespace-nowrap text-muted-foreground transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
        current &&
          'bg-sidebar-current font-semibold text-sidebar-current-foreground',
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

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" data-slot="program-scope-sidebar-tooltip">
        {item.count !== undefined ? `${item.label} ${item.count}` : item.label}
      </TooltipContent>
    </Tooltip>
  );
}
