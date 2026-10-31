'use client';

import { skipToken, useQuery } from '@tanstack/react-query';
import {
  useProgramNavigationMilestonesQuery,
  useProgramOverviewQuery,
  useProgramParticipationQuery,
} from '@/features/programs/catalog/queries';
import type { ProgramOverview } from '@/features/programs/catalog/program-overview-dto';
import type { ProgramNavigationMilestone } from '@/features/programs/catalog/program-navigation-dto';
import { featureKey } from '@/lib/query-keys';
import { SECTION_FACETS, type SectionFacetData } from './section-facets';
import type { ProgramScopeViewerRole, ShellSection } from './sidebar-menu';
import type { MemberAccess } from './member-access';
import {
  programScopeViewerRole,
  shouldLoadProgramOverview,
  shouldLoadProgramParticipation,
} from './program-shell-policy';

export type ShellDataStatus = 'idle' | 'pending' | 'success' | 'error';

export function useProductShellData({
  section,
  programDetailId,
  member,
  authority,
  operationsView = false,
}: {
  readonly section: ShellSection;
  readonly programDetailId: string | null;
  readonly member: boolean;
  readonly authority: MemberAccess;
  readonly operationsView?: boolean | null;
}): {
  readonly facetData: SectionFacetData | undefined;
  readonly facetStatus: ShellDataStatus;
  readonly scopeOverview: ProgramOverview | undefined;
  readonly scopeOverviewStatus: ShellDataStatus;
  readonly scopeMilestones: readonly ProgramNavigationMilestone[] | undefined;
  readonly scopeParticipant: boolean | undefined;
  readonly scopeViewerRole: ProgramScopeViewerRole;
  readonly scopeViewReady: boolean;
} {
  const scopedProgramId = shouldLoadProgramOverview(programDetailId, member)
    ? programDetailId
    : null;
  const participation = useProgramParticipationQuery(
    shouldLoadProgramParticipation(
      programDetailId,
      member,
      authority.memberKind === 'STUDENT',
    )
      ? programDetailId
      : null,
  );
  const scopeParticipant = participation.data;
  const scopeViewerRole = programScopeViewerRole(
    member,
    authority,
    scopeParticipant,
    operationsView ?? false,
  );
  const scopeViewReady =
    operationsView !== null &&
    !(
      scopedProgramId !== null &&
      authority.memberKind === 'STUDENT' &&
      (authority.hasStaffAccess || authority.hasAdminAccess) &&
      !operationsView &&
      participation.isPending
    );
  const overview = useProgramOverviewQuery(
    scopedProgramId,
    scopeViewReady
      ? scopeViewerRole === 'STAFF' || scopeViewerRole === 'ADMIN'
      : null,
  );
  const milestones = useProgramNavigationMilestonesQuery(scopedProgramId);
  const facetLoader =
    programDetailId === null && section
      ? SECTION_FACETS[section]?.load
      : undefined;
  const facets = useQuery({
    queryKey: featureKey('shell-facets', section),
    queryFn: facetLoader ? ({ signal }) => facetLoader(signal) : skipToken,
  });

  return {
    facetData: facetLoader ? facets.data : undefined,
    facetStatus: facetLoader ? facets.status : 'idle',
    scopeOverview: scopeViewReady ? overview.data : undefined,
    scopeOverviewStatus: scopedProgramId === null ? 'idle' : overview.status,
    scopeMilestones: milestones.data,
    scopeParticipant,
    scopeViewerRole,
    scopeViewReady,
  };
}
