'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AppSidebar } from './app-sidebar';
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
 * 상단 ShellNav **아래**에 붙는 업무 레일 — 왼쪽 “내 상황” 사이드바 + 본문.
 *
 * 공개 메뉴·계정 슬롯은 위 공통 Nav가 담당한다(랜딩과 같은 `ShellNav`).
 * 여기는 가입을 마친 사람의 역할 홈만 담는다. 비회원이면 사이드바 없이 본문만.
 *
 * 서버 렌더는 항상 “펼침”이다. localStorage는 브라우저에만 있어 서버가 알 수 없고,
 * 서버·클라이언트가 다른 값을 그리면 hydration이 깨진다.
 */
export function ProductShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const { status, role, isProfileComplete } = useSessionRole();
  const showSituation =
    status === 'assigned' && role !== null && isProfileComplete;
  const groups = showSituation ? sidebarGroupsFor(role) : [];

  const [collapsed, setCollapsed] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(
        readStoredCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)),
      );
    } catch {
      // Safari 프라이빗 모드 등 — 기본값(펼침)
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored || !showSituation) return;
    try {
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        collapsed ? SIDEBAR_COLLAPSED_VALUE : SIDEBAR_OPEN_VALUE,
      );
    } catch {
      // 저장 실패해도 이번 세션 접힘 상태는 유지
    }
  }, [collapsed, restored, showSituation]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

  if (!showSituation || groups.length === 0) {
    return (
      <div id="main-content" tabIndex={-1} className="min-w-0 flex-1">
        {children}
      </div>
    );
  }

  return (
    <div
      data-slot="product-shell"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'grid min-h-0 flex-1 grid-cols-1',
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
      <div id="main-content" tabIndex={-1} className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}
