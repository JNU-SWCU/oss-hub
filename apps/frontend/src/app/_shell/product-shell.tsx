'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  getProgramOverview,
  type ProgramOverview,
} from '@/features/programs/program-overview-api';
import { AppSidebar, AppSidebarNav } from './app-sidebar';
import {
  ProgramScopeSidebar,
  ProgramScopeSidebarNav,
} from './program-scope-sidebar';
import {
  programDetailIdFromPathname,
  SECTION_FACETS,
  type SectionFacetData,
} from './section-facets';
import { SidebarDrawer } from './sidebar-drawer';
import {
  SIDEBAR_COLLAPSED_VALUE,
  SIDEBAR_OPEN_VALUE,
  SIDEBAR_STORAGE_KEY,
} from './sidebar-collapsed';
import {
  programScopeBackHref,
  programScopeSidebarGroups,
  shellSectionFromPathname,
  sidebarBrandTitle,
} from './sidebar-menu';
import { RankingCycleProvider } from './ranking-cycle-context';
import { memberSurfaces, resolveMemberAccess } from './member-access';
import { sidebarGroupsForMemberAccess } from './member-sidebar';
import { useSidebarDrawer } from './sidebar-drawer-context';
import { useSessionRole } from './use-session-role';
import {
  programScopeViewerRole,
  shouldLoadProgramOverview,
  withoutLoadingCounts,
} from './program-shell-policy';

export {
  SidebarDrawerProvider,
  useSidebarDrawer,
} from './sidebar-drawer-context';

export * from './sidebar-collapsed';
export { shouldLoadProgramOverview } from './program-shell-policy';

/**
 * 상단 ShellNav 아래 — **현재 섹션** 하위 사이드 패널 + 본문.
 * 900px 미만에서는 `AppSidebar`/`ProgramScopeSidebar`(`aside`) 대신 `SidebarDrawer`
 * 오버레이가 같은 그룹을 보여준다 — 햄버거는 `ShellNav`(상단 nav)가 `useSidebarDrawer()`
 * 로 이 컴포넌트와 열림 상태를 공유해 연다.
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
  const session = useSessionRole();
  const { status, isProfileComplete } = session;
  const member =
    status === 'assigned' &&
    isProfileComplete &&
    memberSurfaces(session).length > 0;
  const section = shellSectionFromPathname(pathname);
  // `/programs/:id` 하위는 목록 패싯이 아니라 프로그램 스코프 패널로 갈린다
  // (docs/design.md §업무 화면 내비게이션 › 프로그램 스코프 좌측 패널) — section은 여전히 'programs'로
  // 잡히므로 이 id 하나로 두 렌더 경로를 가른다.
  const programDetailId = programDetailIdFromPathname(pathname);

  const [facetData, setFacetData] = useState<SectionFacetData | undefined>(
    undefined,
  );
  const [scopeOverview, setScopeOverview] = useState<
    ProgramOverview | undefined
  >(undefined);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const drawer = useSidebarDrawer();
  const closeDrawer = drawer?.close;

  // 라우트가 바뀌면 드로어를 닫는다 — 셸은 유지되므로 스스로 닫히지 않는다.
  useEffect(() => {
    closeDrawer?.();
  }, [pathname, closeDrawer]);

  // 쿠키 기록 — 첫 페인트는 서버가 이미 맞춰 두었고, 토글 시 동기화만 한다 (F4).
  useEffect(() => {
    document.cookie = `${SIDEBAR_STORAGE_KEY}=${
      collapsed ? SIDEBAR_COLLAPSED_VALUE : SIDEBAR_OPEN_VALUE
    }; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [collapsed]);

  // 섹션 패싯 단일 fetch — AbortController 로 스테일 응답 차단 (C5 / §3.3).
  // 프로그램 상세 스코프에서는 목록 패싯이 필요 없다 — 아래 scopeOverview 이펙트가 대신한다.
  useEffect(() => {
    const spec =
      !programDetailId && section ? SECTION_FACETS[section] : undefined;
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
  }, [section, programDetailId]);

  // 프로그램 스코프 패널 데이터 단일 fetch — 같은 AbortController 규약(C5 / §3.3).
  // getProgramOverview는 signal을 받지 않으므로, 응답 후 aborted 여부만 확인한다
  // (section-facets.ts의 loadProgramFacets 등과 동일한 완화).
  useEffect(() => {
    if (!shouldLoadProgramOverview(programDetailId, member)) {
      setScopeOverview(undefined);
      return;
    }
    const controller = new AbortController();
    setScopeOverview(undefined); // clear stale on program id change (C5)
    void getProgramOverview(programDetailId)
      .then((data) => {
        if (!controller.signal.aborted) setScopeOverview(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setScopeOverview(undefined);
      });
    return () => controller.abort();
  }, [programDetailId, member]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

  const groups = programDetailId
    ? []
    : sidebarGroupsForMemberAccess(
        section,
        member
          ? session
          : {
              memberKind: null,
              hasStaffAccess: false,
              hasAdminAccess: false,
            },
        {
          programCounts: facetData?.programCounts,
          archiveCounts: facetData?.archiveCounts,
          rankingYears: facetData?.rankingYears,
          rankingCounts: facetData?.rankingCounts,
        },
      );

  if (!programDetailId && groups.length === 0) {
    return (
      <RankingCycleProvider>
        <div
          id="main-content"
          tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
        >
          {children}
        </div>
      </RankingCycleProvider>
    );
  }

  // 비회원·미배정·미완료 프로필은 회원 전용 데이터(참여 팀·서류 현황·게시판)를 보일
  // 근거가 없다 — STAFF 골격으로 낮춰 그 항목들을 그대로 보여주던 과거 방식(QA46) 대신
  // 공개 개요 항목만 남는 GUEST로 낮춘다.
  const scopeViewerRole = programScopeViewerRole(
    member,
    resolveMemberAccess(session),
  );

  const scopeGroupsRaw = programDetailId
    ? programScopeSidebarGroups({
        programId: programDetailId,
        viewerRole: scopeViewerRole,
        teamCount: scopeOverview?.teamCount ?? 0,
        boardPostCount: scopeOverview?.boardPostCount ?? 0,
        viewerDocuments:
          scopeViewerRole === 'STUDENT' &&
          scopeOverview?.viewerDocumentsCompleted != null &&
          scopeOverview?.viewerDocumentsTotal != null
            ? {
                completed: scopeOverview.viewerDocumentsCompleted,
                total: scopeOverview.viewerDocumentsTotal,
              }
            : undefined,
        // 서류가 있는 마일스톤을 depth-1 자식으로 편다. 이 값을 넘기지 않으면
        // `programScopeSidebarGroups`의 기본값 `[]` 때문에 자식이 영영 0개다.
        milestoneDocuments: scopeOverview?.milestoneDocuments,
      })
    : [];
  const scopeGroups =
    scopeOverview !== undefined
      ? scopeGroupsRaw
      : withoutLoadingCounts(scopeGroupsRaw);

  const drawerLabel = programDetailId
    ? (scopeOverview?.name ?? programDetailId)
    : sidebarBrandTitle(section, groups);

  return (
    <RankingCycleProvider>
      <div
        data-slot="product-shell"
        data-collapsed={collapsed ? 'true' : 'false'}
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
        {programDetailId ? (
          <ProgramScopeSidebar
            programName={scopeOverview?.name ?? programDetailId}
            groups={scopeGroups}
            pathname={pathname}
            collapsed={collapsed}
            onToggle={toggle}
            backHref={programScopeBackHref()}
            countdown={
              scopeOverview?.nextMilestone
                ? {
                    nextMilestoneLabel: scopeOverview.nextMilestone.label,
                    dueAt: scopeOverview.nextMilestone.dueAt,
                  }
                : null
            }
          />
        ) : (
          <AppSidebar
            groups={groups}
            pathname={pathname}
            search={search}
            collapsed={collapsed}
            onToggle={toggle}
            brandTitle={sidebarBrandTitle(section, groups)}
          />
        )}
        <div
          id="main-content"
          tabIndex={-1}
          className="min-h-0 min-w-0 overflow-y-auto"
        >
          {children}
        </div>
        <SidebarDrawer
          open={drawer?.open ?? false}
          onClose={closeDrawer ?? (() => {})}
          label={drawerLabel}
        >
          {programDetailId ? (
            <ProgramScopeSidebarNav
              groups={scopeGroups}
              pathname={pathname}
              collapsed={false}
              ariaLabel={drawerLabel}
            />
          ) : (
            <AppSidebarNav
              groups={groups}
              pathname={pathname}
              search={search}
              collapsed={false}
              brandTitle={sidebarBrandTitle(section, groups)}
            />
          )}
        </SidebarDrawer>
      </div>
    </RankingCycleProvider>
  );
}
