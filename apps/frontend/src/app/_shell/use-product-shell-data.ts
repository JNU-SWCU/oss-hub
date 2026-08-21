'use client';

import { useEffect, useState } from 'react';
import {
  getProgramOverview,
  type ProgramOverview,
} from '@/features/programs/program-overview-api';
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
} {
  const [facetData, setFacetData] = useState<SectionFacetData>();
  const [scopeOverview, setScopeOverview] = useState<ProgramOverview>();

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

  return { facetData, scopeOverview };
}
