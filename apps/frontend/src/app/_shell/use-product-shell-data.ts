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
import { getMyApplication } from '@/features/programs/student-application-api';
import { ApiError } from '@/lib/api-client';
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
  /** 좌측 패널을 학생 시야로 그리는 뷰어인지. 참여 여부 조회는 이때만 한다(#1099). */
  readonly studentViewer: boolean;
}): {
  readonly facetData: SectionFacetData | undefined;
  readonly scopeOverview: ProgramOverview | undefined;
  readonly scopeMilestones: readonly ProgramNavigationMilestone[] | undefined;
  readonly scopeMilestonesFailed: boolean;
  readonly retryScopeMilestones: () => void;
  /**
   * 이 프로그램의 참여자(승인된 신청)인지. `undefined`는 「아직 모른다」이며 조회 전과
   * 조회 실패를 함께 담는다 — 그 값으로 메뉴를 잠그지 않는다(ADR-007).
   */
  readonly scopeParticipant: boolean | undefined;
} {
  const [facetData, setFacetData] = useState<SectionFacetData>();
  const [scopeOverview, setScopeOverview] = useState<ProgramOverview>();
  const [scopeMilestones, setScopeMilestones] =
    useState<readonly ProgramNavigationMilestone[]>();
  const [scopeMilestonesFailed, setScopeMilestonesFailed] = useState(false);
  const [scopeParticipant, setScopeParticipant] = useState<boolean>();
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

  /**
   * 참여 여부는 개요가 답하지 않는다 — 개요의 `viewerDocuments*`는 승인 전 학생에게도
   * 0/N을 채워 주므로 참여자와 구분되지 않는다. 게시판·제출물 두 관문이 실제로 요구하는
   * 것과 **같은 사실**(승인된 신청)을 주는 응답은 `programs/:id/applications/me` 하나뿐이라
   * 여기서 그것을 읽는다.
   */
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
        if (!controller.signal.aborted) {
          setScopeParticipant(application.status === 'APPROVED');
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // 신청이 아예 없으면 404다 — 참여자가 아님이 확정된다. 그 밖의 실패(네트워크·
        // 5xx)는 모르는 채로 두고 메뉴를 잠그지 않는다.
        setScopeParticipant(
          error instanceof ApiError && error.problem.status === 404
            ? false
            : undefined,
        );
      });
    return () => controller.abort();
  }, [programDetailId, member, studentViewer]);

  return {
    facetData,
    scopeOverview,
    scopeMilestones,
    scopeMilestonesFailed,
    retryScopeMilestones,
    scopeParticipant,
  };
}
