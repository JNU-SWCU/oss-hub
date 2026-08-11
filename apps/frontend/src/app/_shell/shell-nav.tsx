'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { NavBar, type NavItem } from '@/components';
import { useSidebarDrawer } from './product-shell';
import { programDetailIdFromPathname } from './section-facets';
import { shellSectionFromPathname } from './sidebar-menu';
import { COSMOS_GROUND_PATHS } from './signup-routes';
import { SIDEBAR_DRAWER_DIALOG_ID } from './sidebar-drawer';

interface ShellNavProps {
  items: NavItem[];
  brand?: ReactNode;
  actions?: ReactNode;
}

/** 랜딩에서 일반 페이지 구간이 시작되는 지점에 두는 표식 */
export const LANDING_SOLID_SENTINEL_ID = 'landing-solid-sentinel';

/**
 * 전 화면 상단 nav. 컴포넌트는 항상 같고, **색 톤만** 경로에 따라 갈린다.
 * `NavBar`는 건드리지 않고, `[data-surface='inverted']` 토큰 스코프(globals.css)가
 * 하위 shadcn 컴포넌트를 `.dark`와 같은 메커니즘으로 다시 색칠한다.
 *
 * - 랜딩(`/`) 우주 위: 투명 + 흰 글자, `fixed` (sticky 무대 560vh 동안 떠 있음)
 * - 가입 cosmos 경로: 반전 톤, document flow (fixed 아님 — 본문 첫 줄을 덮지 않음)
 * - 그 외(대시보드·공개 목록 등): 흰 바 + 어두운 글자
 *
 * 랜딩에서 여정이 끝나 흰 페이지가 올라오면 흰 글자 헤더는 흰 배경 위에서
 * 사라져 버린다. 그 순간 표면을 바꾼다. 전환 시점을 스크롤 숫자로 박지 않고,
 * 일반 페이지 구간 맨 앞 표식이 헤더 높이까지 올라왔는지를 관찰한다.
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
   * 가입 화면도 어두운 우주 바탕 위에 선다. 랜딩과 달리 도중에 흰 구간으로
   * 넘어가지 않으므로 표식을 관찰할 것이 없고, 처음부터 끝까지 반전이다.
   * `fixed`도 쓰지 않는다 — 가입 화면은 sticky 무대가 아니라 한 화면짜리 폼이라
   * 헤더가 떠 있을 이유가 없고, 떠 있으면 좁은 화면에서 본문 첫 줄을 덮는다.
   */
  const onCosmosGround = COSMOS_GROUND_PATHS.has(pathname);
  const [onSolid, setOnSolid] = useState(false);

  useEffect(() => {
    if (!overlay) {
      setOnSolid(false);
      return;
    }

    let frame: number | null = null;
    // 표식을 매번 다시 찾는다. 헤더는 셸에 있어 본문보다 먼저 준비되므로,
    // 한 번 찾아 보고 없다고 포기하면 영영 전환되지 않는다(실제로 그랬다).
    const sync = (): void => {
      frame = null;
      const sentinel = document.getElementById(LANDING_SOLID_SENTINEL_ID);
      // 헤더 높이(3.5rem)까지 올라왔으면 그 아래는 흰 화면이다.
      setOnSolid(
        sentinel !== null && sentinel.getBoundingClientRect().top <= 56,
      );
    };
    const schedule = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(sync);
    };

    sync();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [overlay, pathname]);

  const inverted = (overlay && !onSolid) || onCosmosGround;

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
      data-surface={inverted ? 'inverted' : undefined}
      data-landing-surface={
        overlay ? (onSolid ? 'solid' : 'over-cosmos') : undefined
      }
    >
      <NavBar
        brand={brand}
        items={items}
        actions={actions}
        // 경로가 바뀌면 접힌 메뉴를 닫는다 — 셸은 유지되므로 스스로 닫히지 않는다.
        menuResetKey={pathname}
        sidebarDrawerOpen={drawer?.open}
        onToggleSidebarDrawer={
          drawer && hasSidebar ? drawer.toggle : undefined
        }
        sidebarDrawerId={SIDEBAR_DRAWER_DIALOG_ID}
        // 터치 타깃은 공개 nav 링크·액션 버튼용이다. 계정 드롭다운의
        // `role=menuitem`까지 잡으면 설정(<a>)만 justify-center가 걸려
        // 로그아웃(<button>)과 글자 정렬이 갈라진다.
        className={`max-[479px]:px-1 [&_a:not([role=menuitem])]:inline-flex [&_a:not([role=menuitem])]:min-h-11 [&_a:not([role=menuitem])]:min-w-11 [&_a:not([role=menuitem])]:items-center [&_a:not([role=menuitem])]:justify-center [&_button:not([role=menuitem])]:min-h-11 [&_button:not([role=menuitem])]:min-w-11${
          inverted ? ' border-transparent' : ''
        }${overlay && onSolid ? ' shadow-sm' : ''}`}
        linkComponent={Link}
      />
    </div>
  );
}
