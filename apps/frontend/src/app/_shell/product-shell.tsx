'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AppSidebar } from './app-sidebar';
import { SECTION_FACETS, type SectionFacetData } from './section-facets';
import {
  SIDEBAR_COLLAPSED_VALUE,
  SIDEBAR_OPEN_VALUE,
  SIDEBAR_STORAGE_KEY,
} from './sidebar-collapsed';
import { shellSectionFromPathname, sidebarGroupsFor } from './sidebar-menu';
import { useSessionRole } from './use-session-role';

export {
  SIDEBAR_COLLAPSED_VALUE,
  SIDEBAR_OPEN_VALUE,
  SIDEBAR_STORAGE_KEY,
  readStoredCollapsed,
} from './sidebar-collapsed';

/**
 * 상단 ShellNav 아래 — **현재 섹션** 하위 사이드 패널 + 본문.
 * 모바일(<900px) 사이드바는 AppSidebar가 숨기고, 본문 칩이 필터를 담당한다.
 * 카운트/연도 fetch는 해당 섹션일 때만 한다 (SECTION_FACETS 단일 이펙트).
 *
 * 초기 collapsed 는 서버 cookies() → layout → AppFrame → initialCollapsed 로
 * 전달해 첫 페인트 점프(localStorage useEffect)를 없앤다 (F4).
 */
export function ProductShell({
  children,
  initialCollapsed = false,
}: {
  readonly children: ReactNode;
  readonly initialCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const { status, role, isProfileComplete } = useSessionRole();
  const member = status === 'assigned' && role !== null && isProfileComplete;
  const section = shellSectionFromPathname(pathname);

  const [facetData, setFacetData] = useState<SectionFacetData | undefined>(
    undefined,
  );
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  // 쿠키 기록 — 첫 페인트는 서버가 이미 맞춰 두었고, 토글 시 동기화만 한다 (F4).
  useEffect(() => {
    document.cookie = `${SIDEBAR_STORAGE_KEY}=${
      collapsed ? SIDEBAR_COLLAPSED_VALUE : SIDEBAR_OPEN_VALUE
    }; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [collapsed]);

  // 섹션 패싯 단일 fetch — AbortController 로 스테일 응답 차단 (C5 / §3.3).
  useEffect(() => {
    const spec = section ? SECTION_FACETS[section] : undefined;
    if (!spec?.load) {
      setFacetData(undefined);
      return;
    }
    const controller = new AbortController();
    setFacetData(undefined); // clear stale on section change (C5)
    void spec
      .load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setFacetData(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFacetData(undefined);
      });
    return () => controller.abort();
  }, [section]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

  const groups = sidebarGroupsFor(section, member ? role : null, {
    programCounts: facetData?.programCounts,
    archiveCounts: facetData?.archiveCounts,
    rankingYears: facetData?.rankingYears,
    rankingCounts: facetData?.rankingCounts,
  });

  if (groups.length === 0) {
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
      data-section={section ?? undefined}
      className={cn(
        'grid min-h-0 flex-1 grid-cols-1',
        // 의도적 레이아웃 애니메이션(grid-template-columns).
        // transform-only 는 main padding 이 어긋나므로 폭 자체에 트랜지션을 건다.
        // 사용자 토글 1회당 1번 — prefers-reduced-motion 시 duration 0 (F5 / §4.6).
        'min-[900px]:transition-[grid-template-columns] motion-reduce:transition-none',
        collapsed
          ? 'min-[900px]:grid-cols-[var(--sidebar-collapsed-width)_minmax(0,1fr)] min-[900px]:duration-[var(--sidebar-collapse-duration)] min-[900px]:ease-in'
          : 'min-[900px]:grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)] min-[900px]:duration-[var(--sidebar-expand-duration)] min-[900px]:ease-out',
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
