'use client';

import { useEffect, useState } from 'react';
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
  readonly operationsView?: boolean;
}): {
  readonly facetData: SectionFacetData | undefined;
  readonly scopeOverview: ProgramOverview | undefined;
  readonly scopeMilestones: readonly ProgramNavigationMilestone[] | undefined;

  readonly scopeParticipant: boolean | undefined;
  readonly scopeViewerRole: ProgramScopeViewerRole;
} {
  const [facetData, setFacetData] = useState<SectionFacetData>();
  const [scopeOverview, setScopeOverview] = useState<ProgramOverview>();
  const [scopeMilestones, setScopeMilestones] =
    useState<readonly ProgramNavigationMilestone[]>();
  const [scopeParticipant, setScopeParticipant] = useState<boolean>();
  const studentViewer = authority.memberKind === 'STUDENT';
  const scopeViewerRole = programScopeViewerRole(
    member,
    authority,
    scopeParticipant,
    operationsView,
  );
  const overviewOperationsView =
    scopeViewerRole === 'STAFF' || scopeViewerRole === 'ADMIN';

  useEffect(() => {
    const spec =
      !programDetailId && section ? SECTION_FACETS[section] : undefined;
    if (!spec?.load) {
      setFacetData(undefined);
      return;
    }
    const controller = new AbortController();
    setFacetData(undefined);
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

  useEffect(() => {
    if (!shouldLoadProgramOverview(programDetailId, member)) {
      setScopeOverview(undefined);
      return;
    }
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
      } catch {
        if (!controller.signal.aborted && currentRequestId === requestId)
          setScopeOverview(undefined);
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
    void load();
    window.addEventListener(MILESTONE_DOCUMENT_SUBMITTED_EVENT, refresh);
    return () => {
      controller.abort();
      window.removeEventListener(MILESTONE_DOCUMENT_SUBMITTED_EVENT, refresh);
    };
  }, [programDetailId, member, overviewOperationsView]);

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
    scopeOverview,
    scopeMilestones,
    scopeParticipant,
    scopeViewerRole,
  };
}
