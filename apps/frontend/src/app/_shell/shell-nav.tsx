'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { NavBar, type NavItem } from '@/components';
import { cn } from '@/lib/utils';
import { useSidebarDrawer } from './product-shell';
import { programDetailIdFromPathname } from './section-facets';
import { shellSectionFromPathname } from './sidebar-menu';
import { SIDEBAR_DRAWER_DIALOG_ID } from './sidebar-drawer';

const LANDING_HERO_ID = 'landing-hero';
const LANDING_HERO_ROOT_MARGIN = '-56px 0px 0px 0px';

interface ShellNavProps {
  items: NavItem[];
  brand?: ReactNode;
  actions?: ReactNode;
}

function useLandingHeroUnderNav(landing: boolean): boolean {
  const [underNav, setUnderNav] = useState(false);

  useEffect(() => {
    if (!landing) return;
    const hero = document.getElementById(LANDING_HERO_ID);
    if (hero === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const latest = entries[entries.length - 1];
        setUnderNav(latest.isIntersecting);
      },
      { rootMargin: LANDING_HERO_ROOT_MARGIN, threshold: 0 },
    );
    observer.observe(hero);

    return () => {
      observer.disconnect();
      setUnderNav(false);
    };
  }, [landing]);

  return landing && underNav;
}

export function ShellNav({ items, brand, actions }: ShellNavProps) {
  const pathname = usePathname();
  const overlay = pathname === '/';
  const heroUnderNav = useLandingHeroUnderNav(overlay);
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
        data-surface={heroUnderNav ? 'inverted' : undefined}
        menuResetKey={pathname}
        sidebarDrawerOpen={drawer?.open}
        onToggleSidebarDrawer={drawer && hasSidebar ? drawer.toggle : undefined}
        sidebarDrawerId={SIDEBAR_DRAWER_DIALOG_ID}

        className={cn(
          'max-[479px]:px-3 [&_a:not([role=menuitem])]:inline-flex',
          '[&_a:not([role=menuitem])]:min-h-11 [&_a:not([role=menuitem])]:min-w-11',
          '[&_a:not([role=menuitem])]:items-center',
          '[&_a:not([role=menuitem])]:justify-center',
          '[&_button:not([role=menuitem])]:min-h-11',
          '[&_button:not([role=menuitem])]:min-w-11',
          overlay && 'transition-[background-color,border-color] duration-200',
          heroUnderNav && 'border-transparent bg-transparent',
        )}
        linkComponent={Link}
      />
    </div>
  );
}
