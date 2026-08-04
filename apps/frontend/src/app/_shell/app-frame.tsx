'use client';

import { usePathname } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import type { NavItem } from '@/components';
import { PUBLIC_MENU } from './public-menus';
import { ProductShell } from './product-shell';
import { ShellNav } from './shell-nav';
import { COSMOS_GROUND_PATHS, PRE_MEMBER_PATHS } from './signup-routes';
import { useSessionRole } from './use-session-role';

/**
 * 상단 4번째 — 회원 공통 대시보드 입구. 가입 완료 시에만 붙인다.
 * href는 항상 `/dashboard`(역할 무관). 본문은 세션 `User.role`로 갈린다.
 * 비로그인·가입 미완료에게는 항목 자체를 붙이지 않으므로 AccessDenied가 날 입구가 아니다.
 */
export const DASHBOARD_NAV_ITEM: NavItem = {
  label: '대시보드',
  href: '/dashboard',
};

/**
 * 전 화면 공통 셸.
 * - 상단: 공개 3 + (회원) 대시보드
 * - 좌측: **현재 섹션** 하위만 (컨텍스트형 ProductShell)
 * - initialSidebarCollapsed: 서버 cookies() 에서 읽어 전달 (F4, client 에선 cookies 불가)
 */
export function AppFrame({
  brand,
  items = PUBLIC_MENU,
  actions,
  children,
  initialSidebarCollapsed = false,
}: {
  readonly brand?: ReactNode;
  readonly items?: readonly NavItem[];
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly initialSidebarCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const { status, isProfileComplete } = useSessionRole();
  const onCosmosGround = COSMOS_GROUND_PATHS.has(pathname);
  const preMember = PRE_MEMBER_PATHS.has(pathname);

  const navItems = useMemo(() => {
    const base = [...items];
    if (status === 'assigned' && isProfileComplete) {
      if (!base.some((item) => item.href === DASHBOARD_NAV_ITEM.href)) {
        base.push(DASHBOARD_NAV_ITEM);
      }
    }
    return base;
  }, [items, status, isProfileComplete]);

  if (preMember) {
    return (
      <div
        className={
          onCosmosGround ? 'flex min-h-dvh flex-col bg-cosmos-void' : undefined
        }
      >
        <ShellNav brand={brand} items={navItems} actions={actions} />
        <div
          className={
            onCosmosGround ? 'flex min-h-0 flex-1 flex-col' : undefined
          }
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <ShellNav brand={brand} items={navItems} actions={actions} />
      <ProductShell initialCollapsed={initialSidebarCollapsed}>
        {children}
      </ProductShell>
    </div>
  );
}
