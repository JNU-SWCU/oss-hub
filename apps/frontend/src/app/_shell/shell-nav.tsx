'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NavBar, type NavItem } from '@/components';

interface ShellNavProps {
  items: NavItem[];
  brand?: ReactNode;
  actions?: ReactNode;
}

/**
 * 랜딩(`/`)에서만 nav를 어두운 히어로 위에 얹는다 — 그 외 라우트는 지금까지와
 * 동일한 흰 바 그대로다. `NavBar`는 건드리지 않고, `[data-surface='inverted']`
 * 토큰 스코프(globals.css)가 하위 shadcn 컴포넌트를 `.dark`와 같은 메커니즘으로
 * 다시 색칠한다.
 */
export function ShellNav({ items, brand, actions }: ShellNavProps) {
  const pathname = usePathname();
  const overlay = pathname === '/';

  return (
    <div
      className={overlay ? 'absolute inset-x-0 top-0 z-20' : undefined}
      data-surface={overlay ? 'inverted' : undefined}
    >
      <NavBar
        brand={brand}
        items={items}
        actions={actions}
        linkComponent={Link}
      />
    </div>
  );
}
