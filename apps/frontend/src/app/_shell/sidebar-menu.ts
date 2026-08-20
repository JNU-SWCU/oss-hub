import type { NavItem } from '@/components';
import {
  ARCHIVE_CATEGORIES,
  ARCHIVE_LIST_FILTER_LABELS,
  archiveListHref,
  type ArchiveCategory,
  type ArchiveCategoryCounts,
} from '@/features/archive/types';
import { programHref } from '@/features/programs/program-paths';
import {
  PROGRAM_LIST_STATUSES,
  PROGRAM_LIST_STATUS_LABELS,
  programListHref,
  type ProgramListStatus,
} from '@/features/programs/types';
import { RANKING_YEAR_ALL, rankingListHref } from '@/features/ranking/types';
import type { AppRole } from './role';
import {
  ADMIN_STAFF_MENU,
  ADMIN_SYSTEM_MENU,
  STAFF_MENU,
  STUDENT_MENU,
} from './role-menus';
import {
  facetSectionFromHrefPath,
  SECTION_FACETS,
  type SectionFacetData,
} from './section-facets';
import type { ShellIconName } from './shell-icons';

/**
 * 왼쪽 사이드 패널 = **현재 상단 섹션의 하위 네비** (컨텍스트형).
 * 프로그램: 전체 + 들여쓴 상태 필터. 대시보드: 역할 홈. 아카이브·랭킹: 섹션 전용(후속 확장).
 */
export interface SidebarItem extends NavItem {
  readonly icon: ShellIconName;
  /** 0 = 부모(전체), 1 = 자식(상태·하위). 데이콘 해커톤 메뉴 depth. */
  readonly depth?: 0 | 1;
  /** 카운트 뱃지. undefined면 미표시, 0도 표시. */
  readonly count?: number;
}

export interface SidebarGroup {
  readonly label: string;
  readonly items: readonly SidebarItem[];
}

export type ShellSection =
  'programs' | 'archive' | 'ranking' | 'dashboard' | null;

const MENU_ICONS: Readonly<Record<string, ShellIconName>> = {
  '/dashboard': 'home',
  '/dashboard/activity': 'chart',
  '/dashboard/insights': 'chart',
  '/dashboard/applicants': 'inbox',
  '/my-repos': 'repo',
  '/programs/new': 'detail',
  '/admin/access': 'people',
  '/admin/audit-log': 'shield',
  '/admin/system-status': 'pulse',
  '/programs': 'list',
  '/archive': 'archive',
  '/ranking': 'chart',
};

const FALLBACK_ICON: ShellIconName = 'detail';

function pathKey(href: string): string {
  return href.split('?')[0] ?? href;
}

function withIcons(
  items: readonly NavItem[],
  depth: 0 | 1 = 0,
): readonly SidebarItem[] {
  return items.map((item) => ({
    ...item,
    depth,
    icon: MENU_ICONS[pathKey(item.href)] ?? FALLBACK_ICON,
  }));
}

const PROGRAM_STATUS_ICONS: Readonly<Record<ProgramListStatus, ShellIconName>> =
  {
    all: 'list',
    recruiting: 'megaphone',
    in_progress: 'play',
    upcoming: 'clock',
    ended: 'checkCircle',
  };

/**
 * 프로그램 메뉴 — 전체·상태 필터가 **같은 깊이**의 피어 목록.
 * 아이콘은 상태 특성별로 구분(접힌 사이드바 식별용).
 */
export function programSidebarGroup(
  counts?: Partial<Record<ProgramListStatus, number>>,
): SidebarGroup {
  const items: SidebarItem[] = PROGRAM_LIST_STATUSES.map((status) => ({
    label: PROGRAM_LIST_STATUS_LABELS[status],
    href: programListHref(status),
    icon: PROGRAM_STATUS_ICONS[status],
    depth: 0 as const,
    count: counts?.[status],
  }));
  return { label: '프로그램 메뉴', items };
}

/** @deprecated 테스트 호환 — `programSidebarGroup()` 사용 */
export const PROGRAM_SIDEBAR_GROUP: SidebarGroup = programSidebarGroup();

export const PROGRAM_SIDEBAR_ITEMS: readonly SidebarItem[] =
  PROGRAM_SIDEBAR_GROUP.items;

/**
 * 프로그램 상세(`/programs/:id` 하위) 스코프 사이드바 — `AppSidebar`/`SidebarItem`과는
 * 별개 모델이다. 이 메뉴의 카운트는 "2/6", "12/47팀" 같은 분수·자유형식이 필요해서
 * (docs/design.md §업무 화면 내비게이션 › 프로그램 스코프 좌측 패널) 숫자 전용인 `SidebarItem.count`를 재사용할 수 없다.
 * 렌더는 `ProgramScopeSidebar`(program-scope-sidebar.tsx) 담당, 여기는 순수 데이터 조립만.
 */
export interface ProgramScopeSidebarItem {
  readonly label: string;
  readonly href: string;
  readonly icon: ShellIconName;
  readonly depth?: 0 | 1;
  /** 사전 포맷된 뱃지 텍스트. undefined면 뱃지 미표시. */
  readonly count?: string;
}

export interface ProgramScopeSidebarGroup {
  readonly label: string;
  readonly items: readonly ProgramScopeSidebarItem[];
}

/**
 * `GUEST`는 세션 조회가 안 끝났거나(loading) 아예 비회원(anonymous)·미배정
 * (unassigned)·프로필 미완료인 뷰어다. 참여 팀·서류 현황·게시판 같은 회원 전용
 * 데이터를 볼 근거가 없어 STAFF 골격으로 낮추던 과거 방식(참여 팀·서류 현황·게시판이
 * 그대로 노출됨) 대신, `programScopeSidebarGroups`가 공개 개요 항목 하나만 돌려준다.
 */
export type ProgramScopeViewerRole = 'GUEST' | 'STUDENT' | 'STAFF' | 'ADMIN';

/**
 * 프로그램 스코프 브랜드 행 「‹ 프로그램 목록」의 목적지.
 * 교직원·관리자의 운영 목록은 `/dashboard`이고, 학생·비회원은 공개 목록 `/programs`다.
 */
export function programScopeBackHref(role: ProgramScopeViewerRole): string {
  if (role === 'STAFF' || role === 'ADMIN') return '/dashboard';
  return '/programs';
}

export interface ProgramScopeMilestoneDocsSummary {
  readonly milestoneId: string;
  readonly title: string;
  /** STUDENT 뷰어: 내가 낸 서류 수. STAFF/ADMIN 뷰어: 완주(전체 서류 제출) 팀 수. */
  readonly completed: number;
  /** STUDENT 뷰어: 그 마일스톤 서류 총수(분모로만 씀). STAFF/ADMIN 뷰어에서는 무시하고
   *  대신 `teamCount`를 분모로 쓴다 — 프로토타입의 고정 표본(8팀)이 아니라 실제 참여
   *  팀 수 기준(docs/design.md §업무 화면 내비게이션 › 참여 팀). */
  readonly total: number;
}

export interface ProgramScopeSidebarInput {
  readonly programId: string;
  readonly viewerRole: ProgramScopeViewerRole;
  readonly teamCount: number;
  readonly boardPostCount: number;
  /** STUDENT 뷰어만 — "내 제출물" 부모 항목 합계
   *  (program-overview 응답의 viewerDocumentsCompleted/viewerDocumentsTotal). */
  readonly viewerDocuments?: {
    readonly completed: number;
    readonly total: number;
  };
  /** 서류가 있는 마일스톤만, 순서대로. 없으면 부모 항목만(자식 없이) 렌더. */
  readonly milestoneDocuments?: readonly ProgramScopeMilestoneDocsSummary[];
}

/**
 * 프로그램 상세 좌측 패널 3그룹(개요/참여 팀 · 서류 현황 또는 내 제출물 · 게시판).
 * docs/design.md §업무 화면 내비게이션 › 프로그램 스코프 좌측 패널 그대로 — g2 부모 라벨·자식 유무는 역할로 갈린다.
 * 교직원·관리자 개요 그룹에는 **신청자**(`/applicants`)를 붙인다 — 승인·반려 창구다.
 * 참여 팀만 두면 사이드바만 따라온 교직원이 판정 화면에 도달하지 못한다.
 * hrefs는 `programHref` 접미사(`/teams`, `/applicants`, `/status`, `/mydocs`, `/board`)로 만든다 —
 * 해당 라우트가 아직 없다면 이 함수 하나만 고치면 된다(docs/design.md §업무 화면 내비게이션 › 프로그램 스코프 좌측 패널).
 *
 * `GUEST`는 예외다 — 참여 팀·신청자·서류 현황·게시판 전부 회원 전용 데이터라 근거 없이 보여줄
 * 수 없다(QA46). 개요 그룹의 "프로그램 개요" 항목 하나만 돌려주고 나머지 두 그룹은
 * 아예 만들지 않는다.
 */
export function programScopeSidebarGroups(
  input: ProgramScopeSidebarInput,
): readonly ProgramScopeSidebarGroup[] {
  const {
    programId,
    viewerRole,
    teamCount,
    boardPostCount,
    viewerDocuments,
    milestoneDocuments = [],
  } = input;

  if (viewerRole === 'GUEST') {
    return [
      {
        label: '프로그램',
        items: [
          {
            label: '프로그램 개요',
            href: programHref(programId),
            icon: 'home',
            depth: 0,
          },
        ],
      },
    ];
  }

  const isStaffView = viewerRole !== 'STUDENT';

  const overviewItems: ProgramScopeSidebarItem[] = [
    {
      label: '프로그램 개요',
      href: programHref(programId),
      icon: 'home',
      depth: 0,
    },
    {
      label: '참여 팀',
      href: programHref(programId, '/teams'),
      icon: 'people',
      depth: 0,
      count: String(teamCount),
    },
  ];
  // 승인·반려는 `/applicants`에만 있다. 학생에게는 권한도 UI도 없으므로 숨긴다.
  if (isStaffView) {
    overviewItems.push({
      label: '신청자',
      href: programHref(programId, '/applicants'),
      icon: 'list',
      depth: 0,
    });
  }

  const overviewGroup: ProgramScopeSidebarGroup = {
    label: '프로그램',
    items: overviewItems,
  };

  const documentsParent: ProgramScopeSidebarItem = isStaffView
    ? {
        label: '서류 현황',
        href: programHref(programId, '/status'),
        icon: 'inbox',
        depth: 0,
      }
    : {
        label: '내 제출물',
        href: programHref(programId, '/mydocs'),
        icon: 'inbox',
        depth: 0,
        count: viewerDocuments
          ? `${viewerDocuments.completed}/${viewerDocuments.total}`
          : undefined,
      };

  const documentsChildren: readonly ProgramScopeSidebarItem[] =
    milestoneDocuments.map((milestone) => ({
      label: milestone.title,
      href: isStaffView
        ? `${programHref(programId, '/status')}?milestoneId=${encodeURIComponent(milestone.milestoneId)}`
        : programHref(programId, '/mydocs'),
      icon: 'inbox',
      depth: 1,
      count: isStaffView
        ? `${milestone.completed}/${teamCount}팀`
        : `${milestone.completed}/${milestone.total}`,
    }));

  const documentsGroup: ProgramScopeSidebarGroup = {
    label: documentsParent.label,
    items: [documentsParent, ...documentsChildren],
  };

  const boardGroup: ProgramScopeSidebarGroup = {
    label: '게시판',
    items: [
      {
        label: '게시판',
        href: programHref(programId, '/board'),
        icon: 'megaphone',
        depth: 0,
        count: String(boardPostCount),
      },
    ],
  };

  return [overviewGroup, documentsGroup, boardGroup];
}

const ARCHIVE_CATEGORY_ICONS: Readonly<
  Record<ArchiveCategory | 'all', ShellIconName>
> = {
  all: 'archive',
  BASIC: 'detail',
  SW_VALUE_SPREAD: 'people',
  OSS_CONTEST: 'trophy',
  CAPSTONE: 'shield',
  SW_CONVERGENCE: 'layers',
  GLOBAL_MAKERTHON: 'globe',
  CORPORATE_INTERNSHIP: 'building',
};

/**
 * 공개 아카이브 메뉴 — 전체·분류 피어 필터 + 분류별 아이콘.
 * URLs: `/archive`, `/archive?category=CAPSTONE`.
 */
export function archiveSidebarGroup(
  counts?: Partial<ArchiveCategoryCounts>,
): SidebarGroup {
  const items: SidebarItem[] = [
    {
      label: ARCHIVE_LIST_FILTER_LABELS.all,
      href: archiveListHref('all'),
      icon: ARCHIVE_CATEGORY_ICONS.all,
      depth: 0,
      count: counts?.all,
    },
    ...ARCHIVE_CATEGORIES.map((category: ArchiveCategory) => ({
      label: ARCHIVE_LIST_FILTER_LABELS[category],
      href: archiveListHref(category),
      icon: ARCHIVE_CATEGORY_ICONS[category],
      depth: 0 as const,
      count: counts?.[category],
    })),
  ];
  return { label: '공개 아카이브', items };
}

/**
 * 랭킹 메뉴 — 전체 + 데이터가 있는 연도(최신 순). 프로그램·아카이브와 같이 피어 필터(depth 0).
 * counts 키: `all` 또는 연도 숫자(선택).
 */
export function rankingSidebarGroup(
  years: readonly number[] = [],
  counts?: Partial<Record<'all' | number, number>>,
): SidebarGroup {
  const items: SidebarItem[] = [
    {
      label: '전체',
      href: rankingListHref(RANKING_YEAR_ALL),
      icon: 'chart',
      depth: 0,
      count: counts?.all,
    },
    ...years.map((year) => ({
      label: String(year),
      href: rankingListHref(year),
      icon: 'chart' as const,
      depth: 0 as const,
      count: counts?.[year],
    })),
  ];
  return { label: '랭킹', items };
}

export const DASHBOARD_SIDEBAR_BRAND = '대시보드';

const ROLE_GROUP_LABEL: Readonly<Record<'STUDENT' | 'STAFF', string>> = {
  STUDENT: '대시보드',
  STAFF: '교직원',
};

const ROLE_MENU: Readonly<Record<'STUDENT' | 'STAFF', readonly NavItem[]>> = {
  STUDENT: STUDENT_MENU,
  STAFF: STAFF_MENU,
};

export function sidebarBrandTitle(
  section: ShellSection,
  groups: readonly SidebarGroup[],
): string {
  if (section === 'dashboard') return DASHBOARD_SIDEBAR_BRAND;
  return groups[0]?.label ?? '메뉴';
}

export function shellSectionFromPathname(pathname: string): ShellSection {
  if (pathname === '/programs' || pathname.startsWith('/programs/')) {
    return 'programs';
  }
  if (pathname === '/archive' || pathname.startsWith('/archive/')) {
    return 'archive';
  }
  if (pathname === '/ranking' || pathname.startsWith('/ranking/')) {
    return 'ranking';
  }
  if (
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/my-repos' ||
    pathname.startsWith('/my-repos/') ||
    pathname.startsWith('/admin/')
  ) {
    return 'dashboard';
  }
  return null;
}

/**
 * 현재 섹션 하나의 그룹만 반환 (컨텍스트형).
 * 비회원도 programs/archive/ranking 하위는 본다.
 * programs/archive/ranking 은 SECTION_FACETS 레지스트리; dashboard 는 역할 메뉴.
 */
export function sidebarGroupsFor(
  section: ShellSection,
  role: AppRole | null,
  options?: {
    readonly programCounts?: Partial<Record<ProgramListStatus, number>>;
    readonly archiveCounts?: Partial<ArchiveCategoryCounts>;
    readonly rankingYears?: readonly number[];
    readonly rankingCounts?: Partial<Record<'all' | number, number>>;
  },
): readonly SidebarGroup[] {
  if (section === 'dashboard') {
    if (role === null) return [];
    if (role === 'ADMIN') {
      return [
        { label: '교직원', items: withIcons(ADMIN_STAFF_MENU, 0) },
        { label: '관리자', items: withIcons(ADMIN_SYSTEM_MENU, 0) },
      ];
    }
    return [
      {
        label: ROLE_GROUP_LABEL[role],
        items: withIcons(ROLE_MENU[role], 0),
      },
    ];
  }
  if (section === null) return [];

  const spec = SECTION_FACETS[section];
  if (!spec) return [];

  const data: SectionFacetData | undefined = {
    programCounts: options?.programCounts,
    archiveCounts: options?.archiveCounts,
    rankingYears: options?.rankingYears,
    rankingCounts: options?.rankingCounts,
  };
  return [{ label: spec.groupLabel, items: spec.items(data) }];
}

/**
 * 현재 메뉴 강조.
 * 패싯 섹션은 `spec.param` 쿼리 피어 비교. 아카이브 상세 예외는 `matchDetail`.
 * 상세(`/programs/id`)는 필터 비강조(프로그램·랭킹).
 */
export function isCurrentSidebarItem(
  pathname: string,
  href: string,
  search = '',
): boolean {
  const qIndex = href.indexOf('?');
  const hrefPath = qIndex === -1 ? href : href.slice(0, qIndex);
  const hrefQuery = qIndex === -1 ? '' : href.slice(qIndex + 1);

  const facetSection = facetSectionFromHrefPath(hrefPath);
  if (facetSection !== null) {
    const spec = SECTION_FACETS[facetSection];
    if (!spec) return false;

    if (spec.matchDetail) {
      const detail = spec.matchDetail(pathname, href, hrefQuery);
      if (detail !== null) return detail;
    } else if (pathname !== hrefPath) {
      return false;
    }

    const want =
      hrefQuery === ''
        ? 'all'
        : (new URLSearchParams(hrefQuery).get(spec.param) ?? 'all');
    // 랭킹은 `year` 부재를 **올해**로 읽는다(ADR-010 §1, `parseRankingYearSearchParam`).
    // 여기서만 `all` 로 읽으면 `/ranking` 에서 「전체」가 강조된 채 올해 수치가 뜬다 —
    // 같은 「전체」 링크가 어디서 왔느냐에 따라 다른 표를 보이게 된다.
    const missingYearFallback =
      facetSection === 'ranking' ? String(new Date().getFullYear()) : 'all';
    const have =
      new URLSearchParams(search).get(spec.param) ?? missingYearFallback;
    // 아카이브 목록: category 키 부재를 all 과 동일 취급 (기존 계약)
    if (facetSection === 'archive') {
      return want === have || (want === 'all' && !search.includes('category='));
    }
    return want === have;
  }

  if (pathname === hrefPath) return true;
  // `/dashboard/activity` 는 별 사이드 항목이라 부모 매칭하지 않는다.
  if (hrefPath === '/dashboard') {
    return false;
  }
  return pathname.startsWith(`${hrefPath}/`);
}
