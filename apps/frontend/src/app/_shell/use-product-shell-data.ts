'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getProgramOverview,
  type ProgramOverview,
} from '@/features/programs/program-overview-api';
import {
  getProgramNavigationMilestones,
  type ProgramNavigationMilestone,
} from '@/features/programs/program-navigation-api';
import { SECTION_FACETS, type SectionFacetData } from './section-facets';
import type { ShellSection } from './sidebar-menu';
import { shouldLoadProgramOverview } from './program-shell-policy';

export function useProductShellData({
  section,
  programDetailId,
  member,
}: {
  readonly section: ShellSection;
  readonly programDetailId: string | null;
  readonly member: boolean;
}): {
  readonly facetData: SectionFacetData | undefined;
  readonly scopeOverview: ProgramOverview | undefined;
  readonly scopeMilestones: readonly ProgramNavigationMilestone[] | undefined;
  readonly scopeMilestonesFailed: boolean;
  readonly retryScopeMilestones: () => void;
} {
  const [facetData, setFacetData] = useState<SectionFacetData>();
  const [scopeOverview, setScopeOverview] = useState<ProgramOverview>();
  const [scopeMilestones, setScopeMilestones] =
    useState<readonly ProgramNavigationMilestone[]>();
  const [scopeMilestonesFailed, setScopeMilestonesFailed] = useState(false);
  const [scopeMilestonesRequest, setScopeMilestonesRequest] = useState(0);
  const retryScopeMilestones = useCallback(
    () => setScopeMilestonesRequest((request) => request + 1),
    [],
  );

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
      setScopeMilestonesFailed(false);
      return;
    }
    const controller = new AbortController();
    setScopeMilestones(undefined);
    setScopeMilestonesFailed(false);
    void getProgramNavigationMilestones(programDetailId)
      .then((milestones) => {
        if (!controller.signal.aborted) {
          setScopeMilestones(milestones);
          setScopeMilestonesFailed(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setScopeMilestones(undefined);
          setScopeMilestonesFailed(true);
        }
      });
    return () => controller.abort();
  }, [programDetailId, member, scopeMilestonesRequest]);

  return {
    facetData,
    scopeOverview,
    scopeMilestones,
    scopeMilestonesFailed,
    retryScopeMilestones,
  };
}
