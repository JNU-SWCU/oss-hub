'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  getProgramOverview,
  type ProgramOverview,
} from '@/features/programs/program-overview-api';
import { AppSidebar } from './app-sidebar';
import { ProgramScopeSidebar } from './program-scope-sidebar';
import {
  programDetailIdFromPathname,
  SECTION_FACETS,
  type SectionFacetData,
} from './section-facets';
import {
  SIDEBAR_COLLAPSED_VALUE,
  SIDEBAR_OPEN_VALUE,
  SIDEBAR_STORAGE_KEY,
} from './sidebar-collapsed';
import {
  programScopeSidebarGroups,
  shellSectionFromPathname,
  sidebarGroupsFor,
  type ProgramScopeSidebarGroup,
  type ProgramScopeViewerRole,
} from './sidebar-menu';
import { useSessionRole } from './use-session-role';

export {
  SIDEBAR_COLLAPSED_VALUE,
  SIDEBAR_OPEN_VALUE,
  SIDEBAR_STORAGE_KEY,
  readStoredCollapsed,
} from './sidebar-collapsed';

/**
 * program-overview fetch가 아직 안 끝났을 때 뱃지를 비운다(하드코딩 금지 —
 * `programScopeSidebarGroups`는 팀 수·게시글 수를 항상 문자열로 채우므로, 로딩 중
 * "0"이 실제 값처럼 보이지 않도록 여기서 depth 0 카운트만 걷어낸다).
 */
function withoutLoadingCounts(
  groups: readonly ProgramScopeSidebarGroup[],
): readonly ProgramScopeSidebarGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.count === undefined ? item : { ...item, count: undefined },
    ),
  }));
}

/**
 * 프로그램 개요를 부를지 판정한다. 개요 endpoint는 `SessionGuard` 뒤에 있어
 * (`program-overview.controller.ts`) 비회원 호출은 반드시 401이다 — 부르지 않는다.
 * 세션 판정이 끝나기 전(`status`가 아직 `assigned`가 아님)에도 부르지 않고, 회원으로
 * 확정된 뒤 이펙트가 다시 돌면서 부른다.
 */
export function shouldLoadProgramOverview(
  programDetailId: string | null,
  member: boolean,
): programDetailId is string {
  return programDetailId !== null && member;
}

/**
 * 상단 ShellNav 아래 — **현재 섹션** 하위 사이드 패널 + 본문.
 * 모바일(<900px) 사이드바는 AppSidebar가 숨기고, 본문 칩이 필터를 담당한다.
 * 카운트/연도 fetch는 해당 섹션일 때만 한다 (SECTION_FACETS 단일 이펙트).
 *
 * 초기 collapsed 는 서버 cookies() → layout → AppFrame → initialCollapsed 로
 * 전달해 첫 페인트 점프(localStorage useEffect)를 없앤다 (F4).
 */
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
  const { status, role, isProfileComplete } = useSessionRole();
  const member = status === 'assigned' && role !== null && isProfileComplete;
  const section = shellSectionFromPathname(pathname);
  // `/programs/:id` 하위는 목록 패싯이 아니라 프로그램 스코프 패널로 갈린다
  // (docs/design.md §업무 화면 내비게이션 › 프로그램 스코프 좌측 패널) — section은 여전히 'programs'로
  // 잡히므로 이 id 하나로 두 렌더 경로를 가른다.
  const programDetailId = programDetailIdFromPathname(pathname);

  const [facetData, setFacetData] = useState<SectionFacetData | undefined>(
    undefined,
  );
  const [scopeOverview, setScopeOverview] = useState<
    ProgramOverview | undefined
  >(undefined);
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  // 쿠키 기록 — 첫 페인트는 서버가 이미 맞춰 두었고, 토글 시 동기화만 한다 (F4).
  useEffect(() => {
    document.cookie = `${SIDEBAR_STORAGE_KEY}=${
      collapsed ? SIDEBAR_COLLAPSED_VALUE : SIDEBAR_OPEN_VALUE
    }; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [collapsed]);

  // 섹션 패싯 단일 fetch — AbortController 로 스테일 응답 차단 (C5 / §3.3).
  // 프로그램 상세 스코프에서는 목록 패싯이 필요 없다 — 아래 scopeOverview 이펙트가 대신한다.
  useEffect(() => {
    const spec =
      !programDetailId && section ? SECTION_FACETS[section] : undefined;
    if (!spec?.load) {
      setFacetData(undefined);
      return;
    }
    const controller = new AbortController();
    setFacetData(undefined); // clear stale on section change (C5)
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

  // 프로그램 스코프 패널 데이터 단일 fetch — 같은 AbortController 규약(C5 / §3.3).
  // getProgramOverview는 signal을 받지 않으므로, 응답 후 aborted 여부만 확인한다
  // (section-facets.ts의 loadProgramFacets 등과 동일한 완화).
  useEffect(() => {
    if (!shouldLoadProgramOverview(programDetailId, member)) {
      setScopeOverview(undefined);
      return;
    }
    const controller = new AbortController();
    setScopeOverview(undefined); // clear stale on program id change (C5)
    void getProgramOverview(programDetailId)
      .then((data) => {
        if (!controller.signal.aborted) setScopeOverview(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setScopeOverview(undefined);
      });
    return () => controller.abort();
  }, [programDetailId, member]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

  const groups = programDetailId
    ? []
    : sidebarGroupsFor(section, member ? role : null, {
        programCounts: facetData?.programCounts,
        archiveCounts: facetData?.archiveCounts,
        rankingYears: facetData?.rankingYears,
        rankingCounts: facetData?.rankingCounts,
      });

  if (!programDetailId && groups.length === 0) {
    return (
      <div id="main-content" tabIndex={-1} className="min-w-0 flex-1">
        {children}
      </div>
    );
  }

  // 비회원·미배정·미완료 프로필은 학생 전용 "내 제출물"을 보일 근거가 없다 — 개인 데이터
  // 없이 안전한 "서류 현황"(STAFF 분기) 골격으로 낮춘다.
  const scopeViewerRole: ProgramScopeViewerRole =
    member && role !== null ? role : 'STAFF';

  const scopeGroupsRaw = programDetailId
    ? programScopeSidebarGroups({
        programId: programDetailId,
        viewerRole: scopeViewerRole,
        teamCount: scopeOverview?.teamCount ?? 0,
        boardPostCount: scopeOverview?.boardPostCount ?? 0,
        viewerDocuments:
          scopeViewerRole === 'STUDENT' &&
          scopeOverview?.viewerDocumentsCompleted != null &&
          scopeOverview?.viewerDocumentsTotal != null
            ? {
                completed: scopeOverview.viewerDocumentsCompleted,
                total: scopeOverview.viewerDocumentsTotal,
              }
            : undefined,
        // 서류가 있는 마일스톤을 depth-1 자식으로 편다. 이 값을 넘기지 않으면
        // `programScopeSidebarGroups`의 기본값 `[]` 때문에 자식이 영영 0개다.
        milestoneDocuments: scopeOverview?.milestoneDocuments,
      })
    : [];
  const scopeGroups =
    scopeOverview !== undefined
      ? scopeGroupsRaw
      : withoutLoadingCounts(scopeGroupsRaw);

  return (
    <div
      data-slot="product-shell"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-section={section ?? undefined}
      className={cn(
        'grid min-h-0 flex-1 grid-cols-1',
        // 의도적 레이아웃 애니메이션(grid-template-columns).
        // transform-only 는 main padding 이 어긋나므로 폭 자체에 트랜지션을 건다.
        // 사용자 토글 1회당 1번 — prefers-reduced-motion 시 duration 0 (F5 / §4.6).
        'min-[900px]:transition-[grid-template-columns] motion-reduce:transition-none',
        collapsed
          ? 'min-[900px]:grid-cols-[var(--sidebar-collapsed-width)_minmax(0,1fr)] min-[900px]:duration-[var(--sidebar-collapse-duration)] min-[900px]:ease-in'
          : 'min-[900px]:grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)] min-[900px]:duration-[var(--sidebar-expand-duration)] min-[900px]:ease-out',
      )}
    >
      {programDetailId ? (
        <ProgramScopeSidebar
          programName={scopeOverview?.name ?? programDetailId}
          groups={scopeGroups}
          pathname={pathname}
          collapsed={collapsed}
          onToggle={toggle}
          countdown={
            scopeOverview?.nextMilestone
              ? {
                  nextMilestoneLabel: scopeOverview.nextMilestone.label,
                  dueAt: scopeOverview.nextMilestone.dueAt,
                }
              : null
          }
        />
      ) : (
        <AppSidebar
          groups={groups}
          pathname={pathname}
          search={search}
          collapsed={collapsed}
          onToggle={toggle}
        />
      )}
      <div id="main-content" tabIndex={-1} className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}
