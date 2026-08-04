'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { NavItem } from '@/components';
import { PUBLIC_MENU } from './public-menus';
import { ProductShell } from './product-shell';
import { ShellNav } from './shell-nav';
import { COSMOS_GROUND_PATHS, PRE_MEMBER_PATHS } from './signup-routes';

/**
 * 전 화면 공통 셸 — **상단 ShellNav(공개 메뉴)는 항상**, 랜딩과 업무가 재사용.
 *
 * - 색 톤만 경로에 따라 갈린다(우주 inverted / 그 외 흰 바) — `shell-nav.tsx`.
 * - 가입 전(`PRE_MEMBER_PATHS`): 상단만. 사이드바를 달면 가입 흐름이 샌다.
 * - 그 외: 상단 아래 `ProductShell` — 가입 완료 회원만 왼쪽 “내 상황” 사이드바.
 *
 * 메뉴 분담: 상단 = `PUBLIC_MENU`(신청·둘러보기), 왼쪽 = `role-menus`(내 상황).
 */
export function AppFrame({
  brand,
  items = PUBLIC_MENU,
  actions,
  children,
}: {
  readonly brand?: ReactNode;
  /** 기본은 공개 메뉴. 테스트에서만 덮어쓸 수 있다. */
  readonly items?: readonly NavItem[];
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const onCosmosGround = COSMOS_GROUND_PATHS.has(pathname);
  const preMember = PRE_MEMBER_PATHS.has(pathname);

  if (preMember) {
    return (
      <div
        className={
          onCosmosGround ? 'flex min-h-dvh flex-col bg-cosmos-void' : undefined
        }
      >
        <ShellNav brand={brand} items={[...items]} actions={actions} />
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

  // L1: 전체 폭 공통 Nav → 아래 사이드바|본문 (ProductShell이 회원만 사이드바)
  return (
    <div className="flex min-h-dvh flex-col">
      <ShellNav brand={brand} items={[...items]} actions={actions} />
      <ProductShell>{children}</ProductShell>
    </div>
  );
}
