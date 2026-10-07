'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AppSidebar, AppSidebarNav } from './app-sidebar';
import {
  ProgramScopeSidebar,
  ProgramScopeSidebarNav,
} from './program-scope-sidebar';
import { programDetailIdFromPathname } from './section-facets';
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
  sidebarGroupsFor,
} from './sidebar-menu';
import { RankingCycleProvider } from './ranking-cycle-context';
import { EMPTY_MEMBER_ACCESS, memberSurfaces } from './member-access';
import { useSidebarDrawer } from './sidebar-drawer-context';
import { useSessionRole } from './use-session-role';
import { useProductShellData } from './use-product-shell-data';
import {
  programScopeViewerRole,
  withoutLoadingCounts,
} from './program-shell-policy';

export {
  SidebarDrawerProvider,
  useSidebarDrawer,
} from './sidebar-drawer-context';

export * from './sidebar-collapsed';
export { shouldLoadProgramOverview } from './program-shell-policy';

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

  const programDetailId = programDetailIdFromPathname(pathname);

  const scopeViewerRole = programScopeViewerRole(member, session);

  const { facetData, scopeOverview, scopeMilestones, scopeParticipant } =
    useProductShellData({
      section,
      programDetailId,
      member,
      studentViewer: scopeViewerRole === 'STUDENT',
    });
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const drawer = useSidebarDrawer();
  const closeDrawer = drawer?.close;

  useEffect(() => {
    closeDrawer?.();
  }, [pathname, search, closeDrawer]);

  useEffect(() => {
    document.cookie = `${SIDEBAR_STORAGE_KEY}=${
      collapsed ? SIDEBAR_COLLAPSED_VALUE : SIDEBAR_OPEN_VALUE
    }; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

  const groups = programDetailId
    ? []
    : sidebarGroupsFor(section, member ? session : EMPTY_MEMBER_ACCESS, {
        programCounts: facetData?.programCounts,
        archiveYears: facetData?.archiveYears,
        rankingYears: facetData?.rankingYears,
        rankingCounts: facetData?.rankingCounts,
      });

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

  let viewerDocuments:
    { readonly completed: number; readonly total: number } | undefined;
  if (
    scopeViewerRole === 'STUDENT' &&
    scopeOverview?.viewerDocumentsCompleted != null &&
    scopeOverview.viewerDocumentsTotal != null
  ) {
    viewerDocuments = {
      completed: scopeOverview.viewerDocumentsCompleted,
      total: scopeOverview.viewerDocumentsTotal,
    };
  }

  const scopeGroupsRaw = programDetailId
    ? programScopeSidebarGroups({
        programId: programDetailId,
        viewerRole: scopeViewerRole,
        teamCount: scopeOverview?.teamCount ?? 0,
        boardPostCount: scopeOverview?.boardPostCount ?? 0,
        viewerDocuments,

        viewerParticipant: scopeParticipant,
        viewerHasAdminAccess: session.hasAdminAccess,
        milestones: scopeMilestones,

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
            search={search}
            collapsed={collapsed}
            onToggle={toggle}
            backHref={programScopeBackHref()}
            remainingMilestones={scopeOverview?.remainingMilestones}
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
              search={search}
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
