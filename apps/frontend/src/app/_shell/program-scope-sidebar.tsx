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
  readonly search: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly backHref: string;
  /** 남은 마감 목록. undefined는 개요 미도착/실패, []는 모든 마감 종료를 뜻한다. */
  readonly remainingMilestones?: readonly CountdownMilestone[];
  readonly milestoneNavigationFailed?: boolean;
  readonly onRetryMilestoneNavigation?: () => void;
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
  milestoneNavigationFailed = false,
  onRetryMilestoneNavigation,
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

      <ProgramScopeSidebarNav
        groups={groups}
        pathname={pathname}
        search={search}
        collapsed={collapsed}
        ariaLabel={programName}
        milestoneNavigationFailed={milestoneNavigationFailed}
        onRetryMilestoneNavigation={onRetryMilestoneNavigation}
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
  readonly milestoneNavigationFailed?: boolean;
  readonly onRetryMilestoneNavigation?: () => void;
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

/**
 * 그룹 렌더 본체 — `ProgramScopeSidebar`(데스크톱 rail)와 `SidebarDrawer`(900px 미만
 * 오버레이)가 공유한다. depth·아이콘·current 마커 규약을 한 곳에서만 유지한다.
 */
export function ProgramScopeSidebarNav({
  groups,
  pathname,
  search,
  collapsed,
  ariaLabel,
  milestoneNavigationFailed = false,
  onRetryMilestoneNavigation,
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
  // 삭제된/잘못된 milestoneId는 본문과 같은 안전한 기본값(모든 단계)으로 보인다.
  // URL은 조용히 바꾸지 않아 사용자가 입력한 주소와 브라우저 이력을 보존한다.
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
        {milestoneNavigationFailed ? (
          <div
            role="alert"
            className={cn(
              'grid w-full gap-2 rounded-control border border-destructive/30 bg-destructive/5 p-3 text-small text-sidebar-foreground',
              collapsed && 'hidden',
            )}
          >
            <p>단계 목록을 불러오지 못했습니다.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={onRetryMilestoneNavigation}
            >
              다시 불러오기
            </Button>
          </div>
        ) : null}
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
                // 같은 이름의 마일스톤도 있으므로 안정적인 목록 순서와 href를 함께 쓴다.
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
