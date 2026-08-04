'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ShellIcon } from './shell-icons';
import { isCurrentSidebarItem, type SidebarGroup } from './sidebar-menu';

/**
 * 왼쪽 “내 상황” 사이드바 — 가입 완료 회원의 역할 홈만.
 * 공개 메뉴·브랜드는 위 공통 `ShellNav`가 담당한다(랜딩과 동일 컴포넌트).
 *
 * - 펼침 248px / 접힘 72px. 폭은 셸 그리드(`ProductShell`) 토큰.
 * - 접힌 상태에서도 아이콘이 링크다. 이름표는 hover·키보드 포커스 모두.
 * - 현재 위치는 배경 + 굵기 + 왼쪽 막대.
 * - 900px 미만은 가로 스크롤 띠(접힘 없음).
 */
interface AppSidebarProps {
  readonly groups: readonly SidebarGroup[];
  readonly pathname: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}

export function AppSidebar({
  groups,
  pathname,
  collapsed,
  onToggle,
}: AppSidebarProps) {
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
              내 상황
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
        aria-label="내 상황"
        className={cn(
          'flex gap-1 overflow-x-auto p-3 min-[900px]:flex-col min-[900px]:gap-0.5 min-[900px]:overflow-x-visible',
          collapsed && 'min-[900px]:items-center min-[900px]:px-2',
        )}
      >
        {groups.map((group, index) => (
          <div
            key={group.label}
            role="group"
            aria-label={group.label}
            className={cn(
              'flex shrink-0 gap-1 min-[900px]:w-full min-[900px]:flex-col min-[900px]:gap-0.5',
              // 접힌 상태에서는 묶음 이름 대신 가는 선으로만 나눈다
              collapsed &&
                index > 0 &&
                'min-[900px]:mt-2 min-[900px]:border-t min-[900px]:border-sidebar-border min-[900px]:pt-2',
            )}
          >
            <p
              aria-hidden
              className={cn(
                'hidden px-3 pt-4 pb-2 text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-muted-foreground',
                !collapsed && 'min-[900px]:block',
              )}
            >
              {group.label}
            </p>
            {group.items.map((item) => {
              const current = isCurrentSidebarItem(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  data-current={current ? 'true' : undefined}
                  className={cn(
                    'group relative flex h-control shrink-0 items-center gap-3 rounded-control px-3 text-[15px] whitespace-nowrap text-muted-foreground transition-colors',
                    'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                    current &&
                      'bg-sidebar-current font-semibold text-sidebar-current-foreground',
                    collapsed &&
                      'min-[900px]:w-control min-[900px]:justify-center min-[900px]:px-0',
                  )}
                >
                  {/* 현재 위치의 세 번째 신호 — 색을 못 보는 사람도 형태로 안다 */}
                  {current ? (
                    <span
                      aria-hidden
                      data-slot="app-sidebar-current-marker"
                      className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sidebar-current-marker"
                    />
                  ) : null}
                  <ShellIcon name={item.icon} />
                  <span className={cn(collapsed && 'min-[900px]:hidden')}>
                    {item.label}
                  </span>
                  {/* 접힌 상태 이름표 — hover와 keyboard focus 양쪽에서 보인다.
                      `aria-hidden`을 붙이지 않는다: 접힌 넓은 화면에서는 위 이름표
                      span이 `display:none`이라 접근성 트리에서 빠지므로, 이것까지
                      숨기면 링크에 이름이 하나도 남지 않는다(아이콘도 aria-hidden). */}
                  {collapsed ? (
                    <span
                      data-slot="app-sidebar-tooltip"
                      className="pointer-events-none absolute top-1/2 left-full z-30 ml-2.5 hidden -translate-y-1/2 rounded-control bg-foreground px-2.5 py-1.5 text-xs font-medium text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 min-[900px]:block"
                    >
                      {item.label}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
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
