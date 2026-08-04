'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
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
 * 상단 ShellNav **아래** 왼쪽 사이드 패널 + 본문.
 *
 * - **프로그램 메뉴**(모집중·진행중·접수대기·종료)는 비회원 포함 항상
 * - **내 상황** 역할 홈은 가입 완료 시에만
 *
 * 서버 렌더는 항상 “펼침”이다 (localStorage hydration).
 */
export function ProductShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const { status, role, isProfileComplete } = useSessionRole();
  const member =
    status === 'assigned' && role !== null && isProfileComplete;
  const groups = sidebarGroupsFor(member ? role : null);

  const [collapsed, setCollapsed] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(
        readStoredCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)),
      );
    } catch {
      // Safari 프라이빗 모드 등
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
      // ignore
    }
  }, [collapsed, restored]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

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
        search={search}
        collapsed={collapsed}
        onToggle={toggle}
      />
      <div id="main-content" tabIndex={-1} className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}
