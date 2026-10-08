'use client';

import { useEffect, useState } from 'react';
import {
  getProgramOverview,
  type ProgramOverview,
} from '@/features/programs/program-overview-api';
import {
  getProgramNavigationMilestones,
  type ProgramNavigationMilestone,
} from '@/features/programs/program-navigation-api';
import { getMyApplication } from '@/features/programs/student-application-api';
import { SECTION_FACETS, type SectionFacetData } from './section-facets';
import type { ShellSection } from './sidebar-menu';
import {
  shouldLoadProgramOverview,
  shouldLoadProgramParticipation,
} from './program-shell-policy';

export function useProductShellData({
  section,
  programDetailId,
  member,
  studentViewer,
}: {
  readonly section: ShellSection;
  readonly programDetailId: string | null;
  readonly member: boolean;

  readonly studentViewer: boolean;
}): {
  readonly facetData: SectionFacetData | undefined;
  readonly scopeOverview: ProgramOverview | undefined;
  readonly scopeMilestones: readonly ProgramNavigationMilestone[] | undefined;

  readonly scopeParticipant: boolean | undefined;
} {
  const [facetData, setFacetData] = useState<SectionFacetData>();
  const [scopeOverview, setScopeOverview] = useState<ProgramOverview>();
  const [scopeMilestones, setScopeMilestones] =
    useState<readonly ProgramNavigationMilestone[]>();
  const [scopeParticipant, setScopeParticipant] = useState<boolean>();

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
    setScopeOverview(undefined);
    void getProgramOverview(programDetailId)
      .then((data) => {
        if (!controller.signal.aborted) setScopeOverview(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setScopeOverview(undefined);
      });
    return () => controller.abort();
  }, [programDetailId, member]);

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
  };
}
