'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { NavItem } from '@/components';
import { ProductShell } from './product-shell';
import { ShellNav } from './shell-nav';

/**
 * 셸 분기 — 랜딩과 업무 화면은 서로 다른 골격을 쓴다.
 *
 * - 랜딩(`/`): 우주 여정 위에 투명 헤더가 떠 있고 흰 구간에 닿으면 흰 바로 바뀐다.
 *   그 동작은 `ShellNav`가 이미 갖고 있으므로 **그대로 둔다**. 사이드바는 넣지 않는다 —
 *   랜딩은 읽고 결정하는 화면이지 이동하는 화면이 아니다.
 * - 그 외: 왼쪽 사이드바 + 상단바(`ProductShell`).
 *
 * 두 갈래 모두 본문을 `id="main-content"`로 감싼다(SkipLink 목적지).
 */
export function AppFrame({
  brand,
  items,
  actions,
  children,
}: {
  readonly brand?: ReactNode;
  readonly items: NavItem[];
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();

  if (pathname === '/') {
    return (
      <>
        <ShellNav brand={brand} items={items} actions={actions} />
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </>
    );
  }

  return <ProductShell actions={actions}>{children}</ProductShell>;
}
