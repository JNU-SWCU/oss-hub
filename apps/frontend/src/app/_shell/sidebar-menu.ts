import type { NavItem } from '@/components';
import { programDocumentsHref, programMyTeamHref } from '@/lib/program-route';
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

export interface SidebarItem extends NavItem {
  readonly icon: ShellIconName;

  readonly depth?: 0 | 1;

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
  '/dashboard/personal': 'home',
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

export interface ProgramScopeSidebarItem {
  readonly label: string;
  readonly href: string;
  readonly icon: ShellIconName;
  readonly depth?: 0 | 1;

  readonly count?: string;
}

export interface ProgramScopeSidebarGroup {
  readonly label: string;
  readonly items: readonly ProgramScopeSidebarItem[];
}

export type ProgramScopeViewerRole = 'GUEST' | 'STUDENT' | 'STAFF' | 'ADMIN';

export function programScopeBackHref(): string {
  return '/programs';
}

interface ProgramScopeMilestoneDocsSummary {
  readonly milestoneId: string;
  readonly title: string;

  readonly completed: number;

  readonly total: number;
}

interface ProgramScopeMilestoneNavigation {
  readonly milestoneId: string;
  readonly title: string;

  readonly submissionEnabled: boolean;
}

export interface ProgramScopeSidebarInput {
  readonly programId: string;
  readonly viewerRole: ProgramScopeViewerRole;
  readonly teamCount: number;
  readonly boardPostCount: number;

  readonly viewerDocuments?: {
    readonly completed: number;
    readonly total: number;
  };

  readonly viewerParticipant?: boolean;

  readonly viewerHasAdminAccess?: boolean;

  readonly milestones?: readonly ProgramScopeMilestoneNavigation[];

  readonly milestoneDocuments?: readonly ProgramScopeMilestoneDocsSummary[];
}

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
  ];

  if (viewerRole === 'STUDENT') {
    overviewItems.push({
      label: '우리 팀',
      href: programMyTeamHref(programId),

      icon: 'building',
      depth: 0,
    });
  }

  overviewItems.push({
    label: isStaffView ? '팀 관리' : '참여 팀',
    href: programHref(programId, '/teams'),
    icon: 'people',
    depth: 0,
    count: String(teamCount),
  });

  const overviewGroup: ProgramScopeSidebarGroup = {
    label: '프로그램',
    items: overviewItems,
  };

  const notParticipantStudent =
    viewerRole === 'STUDENT' && viewerParticipant === false;

  const documentsLocked = notParticipantStudent;

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

const DASHBOARD_SIDEBAR_BRAND = '대시보드';

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
      items: withIcons(
        SURFACE_GROUPS[surface].menu.map((item) =>
          surface === 'student' &&
          access.hasStaffAccess &&
          item.href === '/dashboard'
            ? { ...item, href: '/dashboard/personal' }
            : item,
        ),
        0,
      ),
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

    const missingYearFallback =
      facetSection === 'ranking' ? String(currentRankingYear()) : 'all';
    const have =
      new URLSearchParams(search).get(spec.param) ?? missingYearFallback;

    if (facetSection === 'archive') {
      return want === have || (want === 'all' && !search.includes('year='));
    }
    return want === have;
  }

  if (pathname === hrefPath) return true;

  if (hrefPath === '/dashboard') {
    return false;
  }
  return pathname.startsWith(`${hrefPath}/`);
}
