'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ProgramCountdown } from '@/components';
import type { CountdownMilestone } from '@/components/program-countdown';
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
  useOptionalRankingNextCycleAt,
} from './ranking-cycle-context';
import { useSidebarDrawer } from './sidebar-drawer-context';
import {
  hasShellSidebar,
  isShellMember,
  shellSidebarAccess,
} from './sidebar-presence';
import type { SidebarShellVariant } from './sidebar-shell';
import { useSessionRole } from './use-session-role';
import { useProductShellData } from './use-product-shell-data';
import {
  setProgramOperationsView,
  useProgramOperationsView,
} from './program-operations-view';
import {
  ProgramViewContext,
  isProgramOperationsPath,
  withoutLoadingCounts,
} from './program-shell-policy';

export {
  SidebarDrawerProvider,
  useSidebarDrawer,
} from './sidebar-drawer-context';

export * from './sidebar-collapsed';
export { shouldLoadProgramOverview } from './program-shell-policy';

function RankingCycleCountdown() {
  const nextCycleAt = useOptionalRankingNextCycleAt();
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
  remainingMilestones,
}: {
  readonly pathname: string;
  readonly programDetailId: string | null;
  readonly remainingMilestones: readonly CountdownMilestone[] | undefined;
}): ReactNode {
  if (programDetailId !== null) {
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
    scopeOverview,
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
  const scopeGroups =
    scopeOverview !== undefined
      ? scopeGroupsRaw
      : withoutLoadingCounts(scopeGroupsRaw);

  const brandTitle = sidebarBrandTitle(section, groups);
  const drawerLabel = programDetailId
    ? (scopeOverview?.name ?? programDetailId)
    : brandTitle;

  const bottom = sidebarBottomFor({
    pathname,
    programDetailId,
    remainingMilestones: scopeOverview?.remainingMilestones,
  });

  const sidebar = (variant: SidebarShellVariant) =>
    programDetailId ? (
      <ProgramScopeSidebar
        variant={variant}
        programName={scopeOverview?.name ?? programDetailId}
        groups={scopeGroups}
        pathname={pathname}
        search={search}
        collapsed={variant === 'aside' && collapsed}
        backHref={programScopeBackHref()}
        bottom={bottom}
      />
    ) : (
      <AppSidebar
        variant={variant}
        groups={groups}
        pathname={pathname}
        search={search}
        collapsed={variant === 'aside' && collapsed}
        brandTitle={brandTitle}
        bottom={bottom}
      />
    );

  return (
    <RankingCycleProvider>
      <ProgramViewContext.Provider value={scopeViewerRole}>
        <div
          data-slot="product-shell"
          data-collapsed={collapsed ? 'true' : 'false'}
          className={cn(
            'grid min-h-0 flex-1 grid-cols-1',

            'shell:transition-[grid-template-columns] motion-reduce:transition-none',
            collapsed
              ? 'shell:grid-cols-[var(--sidebar-collapsed-width)_minmax(0,1fr)] shell:duration-[var(--sidebar-collapse-duration)] shell:ease-in'
              : 'shell:grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)] shell:duration-[var(--sidebar-expand-duration)] shell:ease-out',
          )}
        >
          {sidebar('aside')}
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
