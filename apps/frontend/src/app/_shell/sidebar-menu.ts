import type { NavItem } from '@/components';
import {
  PROGRAM_LIST_STATUSES,
  type ProgramListStatus,
} from '@/features/programs/catalog/program-list-options';
import { PROGRAM_LIST_STATUS_LABELS } from '@/features/programs/catalog/program-list-labels';
import { buildProgramListHref } from '@/features/programs/catalog/program-list-url-state';
import {
  currentRankingYear,
  RANKING_YEAR_ALL,
  rankingListHref,
} from '@/features/ranking/types';
import type { MemberAccess, MemberSurface } from './member-access';
import { memberSurfaces } from './member-access';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
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

export type ShellSection = 'programs' | 'ranking' | 'dashboard' | null;

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
  '/ranking': 'chart',
};

const FALLBACK_ICON: ShellIconName = 'detail';

function pathKey(href: string): string {
  return href.split('?')[0] ?? href;
}

export function menuIconFor(href: string): ShellIconName {
  return MENU_ICONS[pathKey(href)] ?? FALLBACK_ICON;
}

function withIcons(
  items: readonly NavItem[],
  depth: 0 | 1 = 0,
): readonly SidebarItem[] {
  return items.map((item) => ({
    ...item,
    depth,
    icon: menuIconFor(item.href),
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
    href: buildProgramListHref({ status }),
    icon: PROGRAM_STATUS_ICONS[status],
    depth: 0 as const,
    count:
      status === 'all' && counts
        ? (counts.all ?? 0) - (counts.ended ?? 0)
        : counts?.[status],
  }));
  return { label: '프로그램 메뉴', items };
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
  admin: { label: '관리자', menu: ADMIN_MENU },
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
    readonly rankingYears?: readonly number[];
    readonly rankingCounts?: Partial<Record<'all' | number, number>>;
  },
): readonly SidebarGroup[] {
  if (section === 'dashboard') {
    if (access === null) return [];
    const seen = new Set<string>();
    return memberSurfaces(access).map((surface) => ({
      label: SURFACE_GROUPS[surface].label,
      items: withIcons(
        SURFACE_GROUPS[surface].menu.filter((item) => {
          if (seen.has(item.href)) return false;
          seen.add(item.href);
          return true;
        }),
      ),
    }));
  }
  if (section === null) return [];

  const spec = SECTION_FACETS[section];
  if (!spec) return [];

  const data: SectionFacetData | undefined = {
    programCounts: options?.programCounts,
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

    const missingYearFallback =
      facetSection === 'ranking' ? String(currentRankingYear()) : 'all';
    const want =
      new URLSearchParams(hrefQuery).get(spec.param) ?? missingYearFallback;
    const have =
      new URLSearchParams(search).get(spec.param) ?? missingYearFallback;

    return want === have;
  }

  if (pathname === hrefPath) return true;

  if (hrefPath === '/dashboard') {
    return false;
  }
  return pathname.startsWith(`${hrefPath}/`);
}

export {
  programScopeBackHref,
  programScopeSidebarGroups,
} from './program-scope-menu';
export type {
  ProgramScopeSidebarItem,
  ProgramScopeSidebarGroup,
  ProgramScopeViewerRole,
} from './program-scope-menu';
