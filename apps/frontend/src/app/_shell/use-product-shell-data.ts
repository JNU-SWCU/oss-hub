'use client';

import { useEffect, useState } from 'react';
import { subscribeBoardListInvalidation } from '@/features/board/board-list-refetch';
import {
  MILESTONE_DOCUMENT_SUBMITTED_EVENT,
  submittedMilestoneId,
} from '@/features/programs/documents/milestone-document-events';
import { getProgramOverview } from '@/features/programs/catalog/program-overview-api';
import type { ProgramOverview } from '@/features/programs/catalog/program-overview-dto';
import { getProgramNavigationMilestones } from '@/features/programs/catalog/program-navigation-api';
import type { ProgramNavigationMilestone } from '@/features/programs/catalog/program-navigation-dto';
import { getMyApplication } from '@/features/programs/applications/student-application-api';
import { SECTION_FACETS, type SectionFacetData } from './section-facets';
import type { ProgramScopeViewerRole, ShellSection } from './sidebar-menu';
import type { MemberAccess } from './member-access';
import {
  programScopeViewerRole,
  shouldLoadProgramOverview,
  shouldLoadProgramParticipation,
} from './program-shell-policy';

export type ShellDataStatus = 'idle' | 'pending' | 'success' | 'error';

interface SettledRequest {
  readonly key: string;
  readonly status: 'success' | 'error';
}

function requestStatus(
  key: string | null,
  settled: SettledRequest | null,
): ShellDataStatus {
  if (key === null) return 'idle';
  return settled?.key === key ? settled.status : 'pending';
}

function overviewRequestKey(programId: string, operationsView: boolean) {
  return `${programId}:${operationsView ? 'operations' : 'viewer'}`;
}

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
} {
  const [facetData, setFacetData] = useState<SectionFacetData>();
  const [facetSettled, setFacetSettled] = useState<SettledRequest | null>(null);
  const [scopeOverview, setScopeOverview] = useState<ProgramOverview>();
  const [overviewSettled, setOverviewSettled] = useState<SettledRequest | null>(
    null,
  );
  const [scopeMilestones, setScopeMilestones] =
    useState<readonly ProgramNavigationMilestone[]>();
  const [scopeParticipant, setScopeParticipant] = useState<boolean>();
  const studentViewer = authority.memberKind === 'STUDENT';
  const scopeViewerRole = programScopeViewerRole(
    member,
    authority,
    scopeParticipant,
    operationsView ?? false,
  );
  const overviewOperationsView =
    scopeViewerRole === 'STAFF' || scopeViewerRole === 'ADMIN';
  const facetKey =
    !programDetailId && section && SECTION_FACETS[section]?.load
      ? section
      : null;
  const overviewKey = shouldLoadProgramOverview(programDetailId, member)
    ? overviewRequestKey(programDetailId, overviewOperationsView)
    : null;
  const facetStatus = requestStatus(facetKey, facetSettled);
  const scopeOverviewStatus = requestStatus(overviewKey, overviewSettled);

  useEffect(() => {
    const spec =
      !programDetailId && section ? SECTION_FACETS[section] : undefined;
    if (!spec?.load || !section) {
      setFacetData(undefined);
      return;
    }
    const controller = new AbortController();
    setFacetData(undefined);
    setFacetSettled(null);
    void spec
      .load(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setFacetData(data);
        setFacetSettled({ key: section, status: 'success' });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFacetData(undefined);
        setFacetSettled({ key: section, status: 'error' });
      });
    return () => controller.abort();
  }, [section, programDetailId]);

  useEffect(() => {
    if (
      operationsView === null ||
      !shouldLoadProgramOverview(programDetailId, member)
    ) {
      setScopeOverview(undefined);
      return;
    }
    const key = overviewRequestKey(programDetailId, overviewOperationsView);
    const controller = new AbortController();
    let requestId = 0;
    let overview: ProgramOverview | undefined;
    const pendingMilestones = new Set<string>();
    const load = async () => {
      const currentRequestId = ++requestId;
      try {
        const data = await getProgramOverview(
          programDetailId,
          overviewOperationsView,
        );
        if (controller.signal.aborted || currentRequestId !== requestId) return;
        overview = data;
        const refreshPending = data.milestoneDocuments.some((milestone) =>
          pendingMilestones.has(milestone.milestoneId),
        );
        pendingMilestones.clear();
        if (refreshPending) {
          void load();
          return;
        }
        setScopeOverview(data);
        setOverviewSettled({ key, status: 'success' });
      } catch {
        if (controller.signal.aborted || currentRequestId !== requestId) return;
        setScopeOverview(undefined);
        setOverviewSettled({ key, status: 'error' });
      }
    };
    const refresh = (event: Event) => {
      const milestoneId = submittedMilestoneId(event);
      if (milestoneId === null) return;
      if (overview === undefined) {
        pendingMilestones.add(milestoneId);
      } else if (
        overview.milestoneDocuments.some(
          (milestone) => milestone.milestoneId === milestoneId,
        )
      ) {
        void load();
      }
    };
    setScopeOverview(undefined);
    setOverviewSettled(null);
    const unsubscribeBoard = subscribeBoardListInvalidation(
      programDetailId,
      () => void load(),
    );
    void load();
    window.addEventListener(MILESTONE_DOCUMENT_SUBMITTED_EVENT, refresh);
    return () => {
      controller.abort();
      unsubscribeBoard();
      window.removeEventListener(MILESTONE_DOCUMENT_SUBMITTED_EVENT, refresh);
    };
  }, [programDetailId, member, overviewOperationsView, operationsView]);

  useEffect(() => {
    if (!shouldLoadProgramOverview(programDetailId, member)) {
      setScopeMilestones(undefined);
      return;
    }
    const controller = new AbortController();
    setScopeMilestones(undefined);

    void getProgramNavigationMilestones(programDetailId)
      .then((milestones) => {
        if (!controller.signal.aborted) setScopeMilestones(milestones);
      })
      .catch(() => {
        if (!controller.signal.aborted) setScopeMilestones(undefined);
      });
    return () => controller.abort();
  }, [programDetailId, member]);

  useEffect(() => {
    if (
      !shouldLoadProgramParticipation(programDetailId, member, studentViewer)
    ) {
      setScopeParticipant(undefined);
      return;
    }
    const controller = new AbortController();
    setScopeParticipant(undefined);
    void getMyApplication(programDetailId)
      .then((application) => {
        if (controller.signal.aborted) return;

        setScopeParticipant(application?.status === 'APPROVED');
      })
      .catch(() => {
        if (controller.signal.aborted) return;

        setScopeParticipant(undefined);
      });
    return () => controller.abort();
  }, [programDetailId, member, studentViewer]);

  return {
    facetData,
    facetStatus,
    scopeOverview,
    scopeOverviewStatus,
    scopeMilestones,
    scopeParticipant,
    scopeViewerRole,
  };
}
