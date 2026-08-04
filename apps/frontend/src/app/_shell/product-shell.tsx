'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { loadArchiveCategoryCounts } from '@/features/archive/api';
import type { ArchiveCategoryCounts } from '@/features/archive/types';
import { getProgramStatusCounts } from '@/features/programs/api';
import type { ProgramStatusCounts } from '@/features/programs/types';
import { getRankingYears } from '@/features/ranking/api';
import { cn } from '@/lib/utils';
import { AppSidebar } from './app-sidebar';
import { shellSectionFromPathname, sidebarGroupsFor } from './sidebar-menu';
import { useSessionRole } from './use-session-role';

export const SIDEBAR_STORAGE_KEY = 'oss-hub-sidebar';
export const SIDEBAR_COLLAPSED_VALUE = 'shut';
export const SIDEBAR_OPEN_VALUE = 'open';

export function readStoredCollapsed(raw: string | null): boolean {
  return raw === SIDEBAR_COLLAPSED_VALUE;
}

/**
 * 상단 ShellNav 아래 — **현재 섹션** 하위 사이드 패널 + 본문.
 * 모바일(<900px) 사이드바는 AppSidebar가 숨기고, 본문 칩이 필터를 담당한다.
 * 카운트/연도 fetch는 해당 섹션일 때만 한다.
 */
export function ProductShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const { status, role, isProfileComplete } = useSessionRole();
  const member = status === 'assigned' && role !== null && isProfileComplete;
  const section = shellSectionFromPathname(pathname);

  const [programCounts, setProgramCounts] = useState<
    ProgramStatusCounts | undefined
  >(undefined);
  const [archiveCounts, setArchiveCounts] = useState<
    Partial<ArchiveCategoryCounts> | undefined
  >(undefined);
  const [rankingYears, setRankingYears] = useState<readonly number[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(
        readStoredCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)),
      );
    } catch {
      // ignore
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

  useEffect(() => {
    if (section !== 'programs') {
      setProgramCounts(undefined);
      return;
    }
    let cancelled = false;
    void getProgramStatusCounts()
      .then((counts) => {
        if (!cancelled) setProgramCounts(counts);
      })
      .catch(() => {
        if (!cancelled) setProgramCounts(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  useEffect(() => {
    if (section !== 'archive') {
      setArchiveCounts(undefined);
      return;
    }
    let active = true;
    loadArchiveCategoryCounts()
      .then((counts) => {
        if (active) setArchiveCounts(counts);
      })
      .catch(() => {
        if (active) setArchiveCounts(undefined);
      });
    return () => {
      active = false;
    };
  }, [section]);

  useEffect(() => {
    if (section !== 'ranking') {
      setRankingYears([]);
      return;
    }
    const controller = new AbortController();
    void getRankingYears(controller.signal)
      .then((years) => {
        if (!controller.signal.aborted) setRankingYears(years);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRankingYears([]);
      });
    return () => controller.abort();
  }, [section]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

  const groups = sidebarGroupsFor(section, member ? role : null, {
    programCounts: section === 'programs' ? programCounts : undefined,
    archiveCounts: section === 'archive' ? archiveCounts : undefined,
    rankingYears: section === 'ranking' ? rankingYears : undefined,
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
