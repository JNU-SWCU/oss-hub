'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NavBar, type NavItem } from '@/components';
import { useSidebarDrawer } from './product-shell';
import { programDetailIdFromPathname } from './section-facets';
import { shellSectionFromPathname } from './sidebar-menu';
import { SIDEBAR_DRAWER_DIALOG_ID } from './sidebar-drawer';

interface ShellNavProps {
  items: NavItem[];
  brand?: ReactNode;
  actions?: ReactNode;
}

/**
 * 전 화면 상단 nav. 색 톤은 경로와 무관하게 `/archive`와 같은 흰 바다.
 * 가입 본문의 우주 반전(`SignupStage`의 `data-surface="inverted"`)은 이 컴포넌트
 * 밖이고, 여기서는 표면을 뒤집지 않는다.
 *
 * 위치만 랜딩(`/`)이 다르다. 여정이 560vh sticky 무대라 문서 흐름이면 스크롤
 * 중 메뉴가 사라지므로 그 경로만 `fixed`로 띄운다. 가입 화면은 한 화면짜리
 * 폼이라 떠 있으면 좁은 폭에서 본문 첫 줄을 덮는다.
 */
export function ShellNav({ items, brand, actions }: ShellNavProps) {
  const pathname = usePathname();
  const overlay = pathname === '/';
  const drawer = useSidebarDrawer();
  // 이 경로에 실제로 열 사이드바 콘텐츠가 있을 때만 900px 미만 햄버거를 보인다 —
  // `ProductShell`이 같은 판정(section/programDetailId)으로 드로어 렌더 여부를 정한다.
  const hasSidebar =
    shellSectionFromPathname(pathname) !== null ||
    programDetailIdFromPathname(pathname) !== null;

  /**
   * 접힌 메뉴에서 항목을 고르면 메뉴를 닫는다.
   *
   * `<details>`의 열림 상태는 브라우저가 들고 있어서, 같은 경로를 다시 누르면
   * (랜딩에서 `홈`) 화면이 그대로라 메뉴만 열린 채 본문을 덮는다. 경로가 바뀌는
   * 경우는 `menuResetKey`가 처리하지만 그때는 pathname이 그대로다.
   *
   * 클릭을 위임해 처리하는 이유는 `NavBar`를 클라이언트 전용으로 만들지 않기
   * 위해서다 — 라우팅을 아는 이쪽이 이미 클라이언트 컴포넌트다.
   */
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
        // 경로가 바뀌면 접힌 메뉴를 닫는다 — 셸은 유지되므로 스스로 닫히지 않는다.
        menuResetKey={pathname}
        sidebarDrawerOpen={drawer?.open}
        onToggleSidebarDrawer={drawer && hasSidebar ? drawer.toggle : undefined}
        sidebarDrawerId={SIDEBAR_DRAWER_DIALOG_ID}
        // 터치 타깃은 공개 nav 링크·액션 버튼용이다. 계정 드롭다운의
        // `role=menuitem`까지 잡으면 설정(<a>)만 justify-center가 걸려
        // 로그아웃(<button>)과 글자 정렬이 갈라진다.
        className="max-[479px]:px-1 [&_a:not([role=menuitem])]:inline-flex [&_a:not([role=menuitem])]:min-h-11 [&_a:not([role=menuitem])]:min-w-11 [&_a:not([role=menuitem])]:items-center [&_a:not([role=menuitem])]:justify-center [&_button:not([role=menuitem])]:min-h-11 [&_button:not([role=menuitem])]:min-w-11"
        linkComponent={Link}
      />
    </div>
  );
}
