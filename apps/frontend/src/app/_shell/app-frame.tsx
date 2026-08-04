'use client';

import { usePathname } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import type { NavItem } from '@/components';
import { PUBLIC_MENU } from './public-menus';
import { ProductShell } from './product-shell';
import { ShellNav } from './shell-nav';
import { COSMOS_GROUND_PATHS, PRE_MEMBER_PATHS } from './signup-routes';
import { useSessionRole } from './use-session-role';

/** 상단 4번째 — 역할 무관 라벨·경로. 가입 완료 시에만 붙인다. */
export const DASHBOARD_NAV_ITEM: NavItem = {
  label: '대시보드',
  href: '/dashboard',
};

/**
 * 전 화면 공통 셸.
 * - 상단: 공개 3 + (회원) 대시보드
 * - 좌측: **현재 섹션** 하위만 (컨텍스트형 ProductShell)
 */
export function AppFrame({
  brand,
  items = PUBLIC_MENU,
  actions,
  children,
}: {
  readonly brand?: ReactNode;
  readonly items?: readonly NavItem[];
  readonly actions?: ReactNode;
  readonly children: ReactNode;
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
          className={onCosmosGround ? 'flex min-h-0 flex-1 flex-col' : undefined}
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
      <ProductShell>{children}</ProductShell>
    </div>
  );
}
