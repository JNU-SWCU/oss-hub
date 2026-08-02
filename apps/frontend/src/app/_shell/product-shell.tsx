'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AppSidebar } from './app-sidebar';
import { AppTopbar } from './app-topbar';
import { sidebarGroupsFor } from './sidebar-menu';
import { useSessionRole } from './use-session-role';

/** 접힘 여부는 사용자가 정한다 — 새로고침해도 유지되도록 브라우저에 기억시킨다. */
export const SIDEBAR_STORAGE_KEY = 'oss-hub-sidebar';
export const SIDEBAR_COLLAPSED_VALUE = 'shut';
export const SIDEBAR_OPEN_VALUE = 'open';

export function readStoredCollapsed(raw: string | null): boolean {
  return raw === SIDEBAR_COLLAPSED_VALUE;
}

/**
 * 랜딩(`/`)을 제외한 모든 라우트의 셸 — 왼쪽 사이드바 + 상단바.
 *
 * 서버 렌더는 항상 "펼침"이다. localStorage는 브라우저에만 있어 서버가 알 수 없고,
 * 서버·클라이언트가 다른 값을 그리면 hydration이 깨진다. 저장된 값은 mount 뒤
 * 한 번 읽어 반영한다.
 */
export function ProductShell({
  actions,
  children,
}: {
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const { status, role } = useSessionRole();
  // 역할이 확정된 사용자만 역할 메뉴를 본다. 조회 중·비로그인·역할 미배정은
  // 공개 메뉴만 — 눌렀을 때 게이트에 튕길 링크를 미리 보여 주지 않는다.
  const groups = sidebarGroupsFor(status === 'assigned' ? role : null);

  const [collapsed, setCollapsed] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(
        readStoredCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)),
      );
    } catch {
      // Safari 프라이빗 모드 등 localStorage 접근이 막힌 환경 — 기본값(펼침)으로 둔다
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        collapsed ? SIDEBAR_COLLAPSED_VALUE : SIDEBAR_OPEN_VALUE,
      );
    } catch {
      // 저장에 실패해도 이번 세션의 접힘 상태는 그대로 동작한다
    }
  }, [collapsed, restored]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

  return (
    <div
      data-slot="product-shell"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'grid min-h-dvh grid-cols-1',
        collapsed
          ? 'min-[900px]:grid-cols-[var(--sidebar-collapsed-width)_minmax(0,1fr)]'
          : 'min-[900px]:grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)]',
      )}
    >
      <AppSidebar
        groups={groups}
        pathname={pathname}
        collapsed={collapsed}
        onToggle={toggle}
      />
      <div className="flex min-w-0 flex-col">
        <AppTopbar pathname={pathname} actions={actions} />
        <div id="main-content" tabIndex={-1} className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
