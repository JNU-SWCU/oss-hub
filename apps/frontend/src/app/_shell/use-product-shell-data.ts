'use client';

import { skipToken, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  useProgramNavigationMilestonesQuery,
  useProgramOverviewQuery,
  useProgramParticipationQuery,
} from '@/features/programs/catalog/queries';
import type { ProgramOverview } from '@/features/programs/catalog/program-overview-dto';
import type { ProgramNavigationMilestone } from '@/features/programs/catalog/program-navigation-dto';
import { currentRankingYear } from '@/features/ranking/types';
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
  const scopeViewerRole = programScopeViewerRole(member, authority);
  const scopeViewReady = operationsView !== null;
  const overview = useProgramOverviewQuery(
    scopedProgramId,
    scopeViewReady ? scopeViewerRole === 'STAFF' : null,
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
  const [rankingCurrentYear, setRankingCurrentYear] =
    useState(currentRankingYear);
  useEffect(() => {
    if (section !== 'ranking') return;
    const updateYear = () => setRankingCurrentYear(currentRankingYear());
    updateYear();
    const interval = setInterval(updateYear, 1000);
    return () => clearInterval(interval);
  }, [section]);

  const facetData = facetLoader ? facets.data : undefined;
  return {
    facetData:
      section === 'ranking' ? { ...facetData, rankingCurrentYear } : facetData,
    facetStatus: facetLoader ? facets.status : 'idle',
    scopeOverview: scopeViewReady ? overview.data : undefined,
    scopeOverviewStatus: scopedProgramId === null ? 'idle' : overview.status,
    scopeMilestones: milestones.data,
    scopeParticipant,
    scopeViewerRole,
    scopeViewReady,
  };
}
