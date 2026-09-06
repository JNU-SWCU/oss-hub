import type { NavItem } from '@/components';
import { programDocumentsHref } from '@/lib/program-route';
import { archiveListHref } from '@/features/archive/types';
import { programHref } from '@/features/programs/program-paths';
import {
  PROGRAM_LIST_STATUSES,
  PROGRAM_LIST_STATUS_LABELS,
  programListHref,
  type ProgramListStatus,
} from '@/features/programs/types';
import {
  currentRankingYear,
  RANKING_YEAR_ALL,
  rankingListHref,
} from '@/features/ranking/types';
import type { MemberAccess, MemberSurface } from './member-access';
import { memberSurfaces } from './member-access';
import { ADMIN_SYSTEM_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
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
  '/dashboard/users': 'people',
  '/dashboard/audit-logs': 'shield',
  '/dashboard/system-status': 'pulse',
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
 * 라벨이 프로그램 목록이므로 역할과 무관하게 `/programs`로 보낸다.
 * 교직원 운영 대시보드(`/dashboard`)와는 다른 화면이다.
 */
export function programScopeBackHref(): string {
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

export interface ProgramScopeMilestoneNavigation {
  readonly milestoneId: string;
  readonly title: string;
  /** 학생의 내 제출물에는 실제 제출을 받는 단계만 노출한다. */
  readonly submissionEnabled: boolean;
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
  /**
   * STUDENT 뷰어만 — 이 프로그램에 승인된 신청이 있는 참여자인지(#1099).
   *
   * `undefined`는 「아직 모른다」다(조회 전이거나 조회가 실패). 이때는 참여자 전용 항목을
   * 그대로 둔다 — 추측한 런타임 상태로 affordance를 지우지 않는다는 ADR-007 규칙을 따르고,
   * 참여자가 자기 메뉴가 사라졌다 돌아오는 깜빡임을 보지 않게 한다. 서버가 「참여자가
   * 아니다」라고 확정해 준 `false`에서만 항목을 내린다.
   */
  readonly viewerParticipant?: boolean;
  /**
   * 이 뷰어가 관리자 접근 권한(`hasAdminAccess`)을 가졌는지.
   *
   * 참여자 전용 판정을 「내 제출물」과 「게시판」이 **따로** 받게 하는 값이다 — 두 화면의
   * 관문이 서로 다른 것을 묻기 때문이다. 회원 유형이 STUDENT이면서 관리자 권한을 가진
   * 계정(권한 행렬이 명시적으로 지원하는 조합)에서만 둘이 갈린다.
   *
   * - **게시판은 열린다.** `board/board-access.guard.ts`는 `hasStaffAccess ||
   *   hasAdminAccess`면 승인된 신청 없이도 교직원 면으로 통과시킨다. 참여자가 아니라는
   *   이유로 이 메뉴를 지우면 실제로 쓸 수 있는 화면으로 가는 길이 끊긴다.
   * - **내 제출물은 열리지 않는다.** 이 주소의 본문은 `hasStaffAccess`로만 교직원 표로
   *   갈리므로(`documents/documents-route.tsx`) 학생 관리자에게는 학생 체크리스트가 뜨고,
   *   그 체크리스트를 지키는 `submissions/submissions.service.ts`의
   *   `requireApprovedApplication`은 관리자 권한을 보지 않는다 — 학생 자격 판정도
   *   `STUDENT_MEMBER_WHERE`(회원 유형만)라 학생 관리자는 그대로 통과한 뒤 승인된 신청이
   *   없어 SUB_003을 받는다. 다른 미신청 학생과 같은 상태이므로 같이 내린다.
   */
  readonly viewerHasAdminAccess?: boolean;
  /** 화면 크기와 무관하게 쓰는 전체 단계 탐색 목록. */
  readonly milestones?: readonly ProgramScopeMilestoneNavigation[];
  /** 서류가 있는 마일스톤만, 순서대로. 없으면 부모 항목만(자식 없이) 렌더. */
  readonly milestoneDocuments?: readonly ProgramScopeMilestoneDocsSummary[];
}

/**
 * 프로그램 상세 좌측 패널 3그룹(개요/참여 팀 · 서류 현황 또는 내 제출물 · 게시판).
 * docs/design.md §업무 화면 내비게이션 › 프로그램 스코프 좌측 패널 그대로 — g2 부모 라벨·자식 유무는 역할로 갈린다.
 * 교직원·관리자 개요 그룹에는 **신청자**(`/applicants`)를 붙인다 — 승인·반려 창구다.
 * 참여 팀만 두면 사이드바만 따라온 교직원이 판정 화면에 도달하지 못한다.
 * hrefs는 `programHref` 접미사(`/teams`, `/applicants`, `/board`)와 역할 공통
 * `programDocumentsHref`로 만든다 —
 * 해당 라우트가 아직 없다면 이 함수 하나만 고치면 된다(docs/design.md §업무 화면 내비게이션 › 프로그램 스코프 좌측 패널).
 *
 * 예외가 둘이다.
 * `GUEST`는 참여 팀·신청자·서류 현황·게시판 전부 회원 전용 데이터라 근거 없이 보여줄
 * 수 없다(QA46). 개요 그룹의 "프로그램 개요" 항목 하나만 돌려주고 나머지 두 그룹은
 * 아예 만들지 않는다.
 * 참여자가 아님이 확정된 학생(`viewerParticipant === false`)에게는 「내 제출물」 그룹을
 * 만들지 않는다 — 승인된 신청이 있어야 열리는 화면이다(#1099). 「게시판」도 참여자 전용이지만
 * 열쇠가 하나 더 있어(관리자 접근) 같은 조건으로 묶지 않는다 — `viewerHasAdminAccess` 주석 참고.
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
    viewerParticipant,
    viewerHasAdminAccess,
    milestones,
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

  /*
    「내 제출물」·「게시판」은 참여자 전용 화면이다. 참여자가 아닌 학생에게는 그 그룹을
    **아예 만들지 않는다**(#1099).

    처음에는 항목을 남기고 「승인 후」 잠금 딱지를 붙였다. 작성자가 눌러 보고 "신청하지
    않으면 애초에 보이지 않으면 될 것을 보이게 해서 복잡하게 만들었다"고 판단해 걷어냈다 —
    누를 수 없는 줄은 메뉴를 길게만 만든다. 신청하면 무엇이 열리는지는 좌측 패널이 아니라
    프로그램 개요의 마일스톤 줄이 말한다(「신청 승인 후 제출할 수 있습니다」 —
    features/programs/components/milestone-row.tsx).

    `viewerParticipant`가 `undefined`(아직 모른다)면 내리지 않는다 — 추측한 런타임 상태로
    affordance를 지우지 않는다(ADR-007). 서버가 확정해 준 `false`에서만 내린다. 링크를 받아
    주소로 직접 들어온 학생은 화면 본문에서 「아직 참여자가 아닙니다」 안내를 만난다
    (components/participant-only-notice.tsx). `GUEST` 분기(위)는 그대로다(QA46).

    **두 그룹을 같은 조건으로 묶지 않는다.** 승인된 신청은 「내 제출물」의 유일한 열쇠지만
    게시판의 열쇠는 그것 하나가 아니다 — 관리자 접근 권한도 게시판을 연다. 하나로 묶으면
    학생 관리자에게서 열려 있는 화면으로 가는 길까지 지운다. 근거는
    `viewerHasAdminAccess` 필드 주석에 있다.
  */
  const notParticipantStudent =
    viewerRole === 'STUDENT' && viewerParticipant === false;
  // 「내 제출물」의 관문은 승인된 신청 하나뿐이다 — 관리자 권한은 이 문을 열지 못한다.
  const documentsLocked = notParticipantStudent;
  // 「게시판」은 관리자 권한만으로도 열린다(board/board-access.guard.ts).
  const boardLocked = notParticipantStudent && viewerHasAdminAccess !== true;

  const fallbackMilestones: readonly ProgramScopeMilestoneNavigation[] =
    milestoneDocuments.map((milestone) => ({
      milestoneId: milestone.milestoneId,
      title: milestone.title,
      submissionEnabled: true,
    }));
  const navigationMilestones = (
    milestones ?? (isStaffView ? fallbackMilestones : [])
  ).filter((milestone) => isStaffView || milestone.submissionEnabled);
  const documentSummaryByMilestone = new Map(
    milestoneDocuments.map((milestone) => [milestone.milestoneId, milestone]),
  );

  const documentsParent: ProgramScopeSidebarItem = isStaffView
    ? {
        label: '서류 현황',
        href: programDocumentsHref(programId),
        icon: 'inbox',
        depth: 0,
      }
    : {
        label: '내 제출물',
        href: programDocumentsHref(programId),
        icon: 'inbox',
        depth: 0,
        count: viewerDocuments
          ? `${viewerDocuments.completed}/${viewerDocuments.total}`
          : undefined,
      };

  const allStagesItem: readonly ProgramScopeSidebarItem[] =
    isStaffView && navigationMilestones.length > 0
      ? [
          {
            label: '모든 단계',
            href: programDocumentsHref(programId),
            icon: 'inbox',
            depth: 1,
            count: `${teamCount}팀`,
          },
        ]
      : [];
  const milestoneItems: readonly ProgramScopeSidebarItem[] =
    navigationMilestones.map((milestone) => {
      const summary = documentSummaryByMilestone.get(milestone.milestoneId);
      return {
        label: milestone.title,
        href: programDocumentsHref(programId, milestone.milestoneId),
        icon: 'inbox',
        depth: 1,
        count: summary
          ? isStaffView
            ? `${summary.completed}/${teamCount}팀`
            : `${summary.completed}/${summary.total}`
          : undefined,
      };
    });
  const documentsChildren = [...allStagesItem, ...milestoneItems];

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

  return [
    overviewGroup,
    ...(documentsLocked ? [] : [documentsGroup]),
    ...(boardLocked ? [] : [boardGroup]),
  ];
}

const ARCHIVE_SIDEBAR_ICON: ShellIconName = 'archive';

/**
 * 공개 아카이브 메뉴 — 전체 + 데이터가 있는 연도(최신 순).
 * URLs: `/archive`, `/archive?year=YYYY`.
 */
export function archiveSidebarGroup(
  years: readonly number[] = [],
): SidebarGroup {
  const items: SidebarItem[] = [
    {
      label: '전체',
      href: archiveListHref('all'),
      icon: ARCHIVE_SIDEBAR_ICON,
      depth: 0,
    },
    ...years.map((year) => ({
      label: String(year),
      href: archiveListHref(year),
      icon: ARCHIVE_SIDEBAR_ICON,
      depth: 0 as const,
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

/**
 * 대시보드 좌측 패널의 surface별 그룹 — 회원 종류(`memberKind`)와 권한
 * (`hasStaffAccess`·`hasAdminAccess`)이 각각 자기 그룹 하나를 켠다.
 *
 * legacy `User.role`은 세 값이 배타적이라 교직원 권한을 가진 학생이나 관리자
 * 권한만 있는 계정을 표현할 수 없었다 — 그래서 `ADMIN`이 교직원 메뉴까지
 * 끌고 오는 식으로 권한을 함축했다. canonical 필드는 서로 독립이므로 여기서도
 * surface마다 한 그룹씩 붙이고 합집합만 만든다. 권한 함축은 만들지 않는다.
 */
const SURFACE_GROUPS: Readonly<
  Record<
    MemberSurface,
    { readonly label: string; readonly menu: readonly NavItem[] }
  >
> = {
  student: { label: '대시보드', menu: STUDENT_MENU },
  staff: { label: '교직원', menu: STAFF_MENU },
  admin: { label: '관리자', menu: ADMIN_SYSTEM_MENU },
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
    pathname.startsWith('/my-repos/')
  ) {
    return 'dashboard';
  }
  return null;
}

/**
 * 현재 섹션 하나의 그룹만 반환 (컨텍스트형).
 * 비회원도 programs/archive/ranking 하위는 본다 — 그래서 `access`는 dashboard에서만 읽는다.
 * programs/archive/ranking 은 SECTION_FACETS 레지스트리; dashboard 는 canonical 권한으로
 * 고른 surface 그룹의 합집합(`SURFACE_GROUPS`)이다.
 */
export function sidebarGroupsFor(
  section: ShellSection,
  access: MemberAccess | null,
  options?: {
    readonly programCounts?: Partial<Record<ProgramListStatus, number>>;
    readonly archiveYears?: readonly number[];
    readonly rankingYears?: readonly number[];
    readonly rankingCounts?: Partial<Record<'all' | number, number>>;
  },
): readonly SidebarGroup[] {
  if (section === 'dashboard') {
    if (access === null) return [];
    return memberSurfaces(access).map((surface) => ({
      label: SURFACE_GROUPS[surface].label,
      items: withIcons(SURFACE_GROUPS[surface].menu, 0),
    }));
  }
  if (section === null) return [];

  const spec = SECTION_FACETS[section];
  if (!spec) return [];

  const data: SectionFacetData | undefined = {
    programCounts: options?.programCounts,
    archiveYears: options?.archiveYears,
    rankingYears: options?.rankingYears,
    rankingCounts: options?.rankingCounts,
  };
  return [{ label: spec.groupLabel, items: spec.items(data) }];
}

/**
 * 현재 메뉴 강조.
 * 패싯 섹션은 `spec.param` 쿼리 피어 비교.
 * 상세(`/programs/id`, `/archive/id`)는 필터 비강조.
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

    if (pathname !== hrefPath) {
      return false;
    }

    const want =
      hrefQuery === ''
        ? 'all'
        : (new URLSearchParams(hrefQuery).get(spec.param) ?? 'all');
    // 랭킹은 `year` 부재를 **올해**로 읽는다(ADR-010 §1, `parseRankingYearSearchParam`).
    // 여기서만 `all` 로 읽으면 `/ranking` 에서 「전체」가 강조된 채 올해 수치가 뜬다 —
    // 같은 「전체」 링크가 어디서 왔느냐에 따라 다른 표를 보이게 된다.
    //
    // 그 「올해」는 본문과 **같은 함수**로만 정한다. `new Date().getFullYear()` 로 따로
    // 세면 기기 시계의 연도가 나와, KST 가 아닌 기기에서 연도가 넘어가는 구간에는
    // 서울 연도로 그려진 표와 값이 갈려 강조되는 항목이 하나도 없게 된다.
    const missingYearFallback =
      facetSection === 'ranking' ? String(currentRankingYear()) : 'all';
    const have =
      new URLSearchParams(search).get(spec.param) ?? missingYearFallback;
    // 아카이브 목록: year 키 부재를 all 과 동일 취급 (기존 계약)
    if (facetSection === 'archive') {
      return want === have || (want === 'all' && !search.includes('year='));
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
