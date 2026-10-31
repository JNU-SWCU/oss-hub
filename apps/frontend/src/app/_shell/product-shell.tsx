'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ProgramCountdown } from '@/components';
import type { CountdownMilestone } from '@/components/program/program-countdown';
import { cn } from '@/lib/utils';
import { AppSidebar } from './app-sidebar';
import { ProgramScopeSidebar } from './program-scope-sidebar';
import { programDetailIdFromPathname } from './section-facets';
import { SidebarDrawer } from './sidebar-drawer';
import {
  programScopeBackHref,
  programScopeSidebarGroups,
  shellSectionFromPathname,
  sidebarBrandTitle,
  sidebarGroupsFor,
} from './sidebar-menu';
import {
  RankingCycleProvider,
  useOptionalRankingCycleReported,
  useOptionalRankingNextCycleAt,
} from './ranking-cycle-context';
import { useSidebarDrawer } from './sidebar-drawer-context';
import {
  hasShellSidebar,
  isShellMember,
  shellSidebarAccess,
} from './sidebar-presence';
import {
  SidebarBottomSkeleton,
  SidebarPhaseContext,
  useSidebarPhase,
  type SidebarShellVariant,
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

export { SidebarDrawerProvider } from './sidebar-drawer-context';

export * from './sidebar-collapsed';
export { shouldLoadProgramOverview } from './program-shell-policy';

function RankingCycleCountdown() {
  const nextCycleAt = useOptionalRankingNextCycleAt();
  const reported = useOptionalRankingCycleReported();
  if (!reported) return <SidebarBottomSkeleton />;
  if (nextCycleAt === null) return null;
  return (
    <ProgramCountdown
      nextMilestoneLabel="다음 수집"
      dueAt={nextCycleAt}
      untilLabel="다음 수집까지"
    />
  );
}

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
  const shell = useSidebarDrawer();
  const collapsed = shell?.collapsed ?? initialCollapsed;
  const sidebarPhase = useSidebarPhase(collapsed);
  const railCollapsed = sidebarPhase.phase === 'collapsed';
  const closeDrawer = shell?.close;

  useEffect(() => {
    closeDrawer?.();
  }, [pathname, search, closeDrawer]);

  if (programDetailId !== null && operationsView === null) return null;

  if (!hasShellSidebar(pathname, session)) {
    return (
      <RankingCycleProvider>
        <div
          id="main-content"
          tabIndex={-1}
          className="relative min-h-0 min-w-0 flex-1 overflow-y-auto"
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
  const drawerLabel = programDetailId
    ? (scopeOverview?.name ?? programDetailId)
    : brandTitle;

  const bottom = sidebarBottomFor({
    pathname,
    programDetailId,
    overviewStatus: scopeOverviewStatus,
    remainingMilestones: scopeOverview?.remainingMilestones,
  });

  const sidebar = (variant: SidebarShellVariant) =>
    programDetailId ? (
      <ProgramScopeSidebar
        variant={variant}
        programName={scopeOverview?.name ?? programDetailId}
        programNamePending={scopePending}
        countsPending={scopePending}
        groups={scopeGroups}
        pathname={pathname}
        search={search}
        collapsed={variant === 'aside' && railCollapsed}
        backHref={programScopeBackHref()}
        bottom={bottom}
      />
    ) : (
      <AppSidebar
        variant={variant}
        groups={groups}
        pathname={pathname}
        search={search}
        collapsed={variant === 'aside' && railCollapsed}
        brandTitle={brandTitle}
        bottom={bottom}
        countsPending={facetCountsPending}
      />
    );

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
            {sidebar('aside')}
          </SidebarPhaseContext.Provider>
          <div
            id="main-content"
            tabIndex={-1}
            className="relative min-h-0 min-w-0 overflow-y-auto"
          >
            {children}
          </div>
          <SidebarDrawer
            open={shell?.open ?? false}
            onClose={closeDrawer ?? (() => {})}
            label={drawerLabel}
          >
            {sidebar('drawer')}
          </SidebarDrawer>
        </div>
      </ProgramViewContext.Provider>
    </RankingCycleProvider>
  );
}
