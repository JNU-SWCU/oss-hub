'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ProgramCountdown } from '@/components';
import type { CountdownMilestone } from '@/components/program/program-countdown';
import { cn } from '@/lib/utils';
import { AppSidebar, AppSidebarNav } from './app-sidebar';
import {
  ProgramScopeSidebar,
  ProgramScopeSidebarNav,
} from './program-scope-sidebar';
import { useReportedProgramName } from './program-name-report-context';
import { ScopeBar, type ScopeBarScope } from './scope-bar';
import { programDetailIdFromPathname } from './section-facets';
import { ShellFacetsContext } from './shell-facets-context';
import { ShellMenuSheet } from './shell-menu-sheet';
import {
  isCurrentSidebarItem,
  programScopeBackHref,
  programScopeSidebarGroups,
  shellSectionFromPathname,
  sidebarBrandTitle,
  sidebarGroupsFor,
  type ProgramScopeSidebarGroup,
  type SidebarGroup,
} from './sidebar-menu';
import { RankingCycleProvider } from './ranking-cycle-context';
import { RankingCycleCountdown } from './ranking-cycle-countdown';
import { useShellMenu } from './shell-menu-context';
import {
  hasShellSidebar,
  isShellMember,
  shellSheetKind,
  shellSidebarAccess,
} from './sidebar-presence';
import {
  SidebarBottomSkeleton,
  SidebarFoot,
  SidebarPhaseContext,
  useSidebarPhase,
  type SidebarShellKind,
} from './sidebar-shell';
import { useSessionRole } from './use-session-role';
import {
  useProductShellData,
  type ShellDataStatus,
} from './use-product-shell-data';
import {
  setProgramOperationsView,
  useProgramOperationsView,
} from './program-operations-view';
import {
  ProgramViewContext,
  isProgramOperationsPath,
  withoutLoadingCounts,
} from './program-shell-policy';

export { ShellMenuProvider } from './shell-menu-context';

export * from './sidebar-collapsed';
export { shouldLoadProgramOverview } from './program-shell-policy';

const MENU_FALLBACK_LABEL = '메뉴';

const noop = () => {};

function sidebarBottomFor({
  pathname,
  programDetailId,
  overviewStatus,
  remainingMilestones,
}: {
  readonly pathname: string;
  readonly programDetailId: string | null;
  readonly overviewStatus: ShellDataStatus;
  readonly remainingMilestones: readonly CountdownMilestone[] | undefined;
}): ReactNode {
  if (programDetailId !== null) {
    if (overviewStatus === 'pending') return <SidebarBottomSkeleton />;
    return remainingMilestones === undefined ? undefined : (
      <ProgramCountdown mode="program" milestones={remainingMilestones} />
    );
  }
  if (pathname === '/ranking') return <RankingCycleCountdown />;
  return undefined;
}

function currentScopeMenuLabel(
  groups: readonly ProgramScopeSidebarGroup[],
  pathname: string,
): string {
  for (const group of groups) {
    for (const item of group.items) {
      if (
        (item.depth ?? 0) === 0 &&
        !item.isViewSwitch &&
        pathname === item.href.split('?')[0]
      ) {
        return item.label;
      }
    }
  }
  return MENU_FALLBACK_LABEL;
}

function currentSidebarMenuLabel(
  groups: readonly SidebarGroup[],
  pathname: string,
  search: string,
): string {
  for (const group of groups) {
    for (const item of group.items) {
      if (isCurrentSidebarItem(pathname, item.href, search)) return item.label;
    }
  }
  return MENU_FALLBACK_LABEL;
}

interface MenuSheetModel {
  readonly scope: ScopeBarScope;
  readonly menuLabel: string;
  readonly nav: ReactNode;
  readonly footKind: SidebarShellKind;
}

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
  const member = isShellMember(session);
  const section = shellSectionFromPathname(pathname);

  const programDetailId = programDetailIdFromPathname(pathname);

  const storedOperationsView = useProgramOperationsView(programDetailId);
  const operationsPath = isProgramOperationsPath(pathname);
  const operationsView =
    storedOperationsView === null
      ? null
      : storedOperationsView || operationsPath;

  useEffect(() => {
    if (programDetailId !== null && operationsPath) {
      setProgramOperationsView(programDetailId, true);
    }
  }, [programDetailId, operationsPath]);

  const {
    facetData,
    facetStatus,
    scopeOverview,
    scopeOverviewStatus,
    scopeMilestones,
    scopeParticipant,
    scopeViewerRole,
  } = useProductShellData({
    section,
    programDetailId,
    member,
    authority: session,
    operationsView,
  });
  const shell = useShellMenu();
  const collapsed = shell?.collapsed ?? initialCollapsed;
  const sidebarPhase = useSidebarPhase(collapsed);
  const railCollapsed = sidebarPhase.phase === 'collapsed';
  const sheetOpen = shell?.sheetOpen ?? false;
  const closeSheet = shell?.closeSheet;
  const reportedProgramName = useReportedProgramName(programDetailId);
  const sheetTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeSheet?.();
  }, [pathname, search, closeSheet]);

  if (programDetailId !== null && operationsView === null) return null;

  if (!hasShellSidebar(pathname, session)) {
    return (
      <RankingCycleProvider>
        <div
          id="main-content"
          tabIndex={-1}
          className="relative min-h-0 min-w-0 flex-1 overflow-y-auto pb-bottom-tabs-clearance shell:pb-0"
        >
          {children}
        </div>
      </RankingCycleProvider>
    );
  }

  const groups = programDetailId
    ? []
    : sidebarGroupsFor(section, shellSidebarAccess(session), {
        programCounts: facetData?.programCounts,
        rankingYears: facetData?.rankingYears,
        rankingCounts: facetData?.rankingCounts,
      });

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
        canSwitchView:
          scopeParticipant === true &&
          session.memberKind === 'STUDENT' &&
          (session.hasStaffAccess || session.hasAdminAccess),
        operationsView: operationsView ?? false,
        milestones: scopeMilestones,

        milestoneDocuments: scopeOverview?.milestoneDocuments,
      })
    : [];
  const scopePending = scopeOverviewStatus === 'pending';
  const scopeGroups =
    scopeOverview !== undefined || scopePending
      ? scopeGroupsRaw
      : withoutLoadingCounts(scopeGroupsRaw);
  const facetCountsPending =
    facetStatus === 'pending' && section === 'programs';

  const brandTitle = sidebarBrandTitle(section, groups);

  const bottom = sidebarBottomFor({
    pathname,
    programDetailId,
    overviewStatus: scopeOverviewStatus,
    remainingMilestones: scopeOverview?.remainingMilestones,
  });

  const sidebar = programDetailId ? (
    <ProgramScopeSidebar
      programName={scopeOverview?.name ?? programDetailId}
      programNamePending={scopePending}
      countsPending={scopePending}
      groups={scopeGroups}
      pathname={pathname}
      search={search}
      collapsed={railCollapsed}
      backHref={programScopeBackHref()}
      bottom={bottom}
    />
  ) : (
    <AppSidebar
      groups={groups}
      pathname={pathname}
      search={search}
      collapsed={railCollapsed}
      brandTitle={brandTitle}
      bottom={bottom}
      countsPending={facetCountsPending}
    />
  );

  let menuSheet: MenuSheetModel | null = null;
  if (shellSheetKind(pathname, session) !== null) {
    if (programDetailId !== null) {
      const programTitle =
        scopeOverview?.name ?? reportedProgramName ?? programDetailId;
      menuSheet = {
        scope: {
          kind: 'program',
          backHref: programScopeBackHref(),
          title: programTitle,
          titlePending: scopePending,
        },
        menuLabel: currentScopeMenuLabel(scopeGroups, pathname),
        nav: (
          <ProgramScopeSidebarNav
            groups={scopeGroups}
            pathname={pathname}
            search={search}
            collapsed={false}
            ariaLabel={programTitle}
            countsPending={scopePending}
          />
        ),
        footKind: 'program-scope-sidebar',
      };
    } else {
      menuSheet = {
        scope: { kind: 'dashboard', title: brandTitle },
        menuLabel: currentSidebarMenuLabel(groups, pathname, search),
        nav: (
          <AppSidebarNav
            groups={groups}
            pathname={pathname}
            search={search}
            collapsed={false}
            brandTitle={brandTitle}
            countsPending={facetCountsPending}
          />
        ),
        footKind: 'app-sidebar',
      };
    }
  }

  return (
    <RankingCycleProvider>
      <ProgramViewContext.Provider value={scopeViewerRole}>
        <div
          data-slot="product-shell"
          data-collapsed={collapsed ? 'true' : 'false'}
          data-sidebar-phase={sidebarPhase.phase}
          className={cn(
            'grid min-h-0 flex-1 grid-cols-1',
            railCollapsed
              ? 'shell:grid-cols-[var(--sidebar-collapsed-width)_minmax(0,1fr)]'
              : 'shell:grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)]',
          )}
        >
          <SidebarPhaseContext.Provider value={sidebarPhase}>
            {sidebar}
          </SidebarPhaseContext.Provider>
          <div className="flex min-h-0 min-w-0 flex-col">
            {menuSheet ? (
              <ScopeBar
                scope={menuSheet.scope}
                menuLabel={menuSheet.menuLabel}
                sheetOpen={sheetOpen}
                onOpenSheet={shell?.openSheet ?? noop}
                triggerRef={sheetTriggerRef}
              />
            ) : null}
            <div
              id="main-content"
              tabIndex={-1}
              className="relative min-h-0 min-w-0 flex-1 overflow-y-auto pb-bottom-tabs-clearance shell:pb-0"

            >
              <ShellFacetsContext.Provider
                value={{ section, groups, facetStatus, pathname, search }}
              >
                {children}
              </ShellFacetsContext.Provider>
            </div>
          </div>
          {menuSheet ? (
            <ShellMenuSheet
              open={sheetOpen}
              onClose={closeSheet ?? noop}
              title={menuSheet.scope.title}
              returnFocusRef={sheetTriggerRef}
            >
              {menuSheet.nav}
              {bottom}
              <SidebarFoot kind={menuSheet.footKind} />
            </ShellMenuSheet>
          ) : null}
        </div>
      </ProgramViewContext.Provider>
    </RankingCycleProvider>
  );
}
