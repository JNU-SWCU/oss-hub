'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NavBar, type NavItem } from '@/components';
import { cn } from '@/lib/utils';
import { useSidebarDrawer } from './product-shell';
import { programDetailIdFromPathname } from './section-facets';
import { shellSectionFromPathname } from './sidebar-menu';
import { SIDEBAR_DRAWER_DIALOG_ID } from './sidebar-drawer';

interface ShellNavProps {
  items: NavItem[];
  brand?: ReactNode;
  actions?: ReactNode;
}

export function ShellNav({ items, brand, actions }: ShellNavProps) {
  const pathname = usePathname();
  const overlay = pathname === '/';
  const drawer = useSidebarDrawer();

  const hasSidebar =
    shellSectionFromPathname(pathname) !== null ||
    programDetailIdFromPathname(pathname) !== null;

  const closeCollapsedMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-slot="nav-bar-menu-items"] a')) return;
    target
      .closest('details[data-slot="nav-bar-menu"]')
      ?.removeAttribute('open');
  };

  return (
    <div
      onClick={closeCollapsedMenu}
      className={overlay ? 'fixed inset-x-0 top-0 z-40' : undefined}
    >
      <NavBar
        brand={brand}
        items={items}
        actions={actions}

        menuResetKey={pathname}
        sidebarDrawerOpen={drawer?.open}
        onToggleSidebarDrawer={drawer && hasSidebar ? drawer.toggle : undefined}
        sidebarDrawerId={SIDEBAR_DRAWER_DIALOG_ID}

        className={cn(
          'max-[479px]:px-1 [&_a:not([role=menuitem])]:inline-flex',
          '[&_a:not([role=menuitem])]:min-h-11 [&_a:not([role=menuitem])]:min-w-11',
          '[&_a:not([role=menuitem])]:items-center',
          '[&_a:not([role=menuitem])]:justify-center',
          '[&_button:not([role=menuitem])]:min-h-11',
          '[&_button:not([role=menuitem])]:min-w-11',
        )}
        linkComponent={Link}
      />
    </div>
  );
}
