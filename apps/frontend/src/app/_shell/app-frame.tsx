'use client';

import { hasAuthError } from '@/features/auth/auth-error';
import {
  getLoginDestinationStorage,
  takeLoginDestination,
} from '@/features/auth/login-destination';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, type ReactNode } from 'react';
import type { NavItem } from '@/components';
import { PUBLIC_MENU } from './public-menus';
import { ProductShell, SidebarDrawerProvider } from './product-shell';
import { ShellNav } from './shell-nav';
import { COSMOS_GROUND_PATHS, PRE_MEMBER_PATHS } from './signup-routes';
import { SessionRoleProvider } from './session-role-context';
import { useSessionRole } from './use-session-role';

const DASHBOARD_NAV_ITEM: NavItem = {
  label: '대시보드',
  href: '/dashboard',
};

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
  const session = useSessionRole();
  const { status, isProfileComplete } = session;
  useEffect(() => {
    if (status !== 'assigned' || !isProfileComplete) return;
    if (pathname !== '/' && pathname !== '/dashboard') return;
    if (hasAuthError(window.location.search)) return;
    const destination = takeLoginDestination(getLoginDestinationStorage());
    if (destination && destination !== pathname)
      window.location.replace(destination);
  }, [status, isProfileComplete, pathname]);
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
      <SessionRoleProvider value={session}>
        <div
          className={
            onCosmosGround
              ? 'flex min-h-dvh flex-col bg-cosmos-void'
              : undefined
          }
        >
          <ShellNav brand={brand} items={navItems} actions={actions} />

          <div
            className={
              onCosmosGround ? 'flex min-h-0 flex-1 flex-col' : undefined
            }
            data-surface={onCosmosGround ? 'inverted' : undefined}
            id="main-content"
            tabIndex={-1}
          >
            {children}
          </div>
        </div>
      </SessionRoleProvider>
    );
  }

  return (
    <SessionRoleProvider value={session}>
      <SidebarDrawerProvider>
        <div className="flex h-dvh flex-col overflow-hidden">
          <ShellNav brand={brand} items={navItems} actions={actions} />
          <ProductShell initialCollapsed={initialSidebarCollapsed}>
            {children}
          </ProductShell>
        </div>
      </SidebarDrawerProvider>
    </SessionRoleProvider>
  );
}
