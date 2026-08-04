import type { NavItem } from '@/components';
import {
  ARCHIVE_CATEGORIES,
  ARCHIVE_LIST_FILTER_LABELS,
  archiveListHref,
  type ArchiveCategory,
  type ArchiveCategoryCounts,
} from '@/features/archive/types';
import {
  PROGRAM_LIST_STATUSES,
  PROGRAM_LIST_STATUS_LABELS,
  programListHref,
  type ProgramListStatus,
} from '@/features/programs/types';
import {
  RANKING_YEAR_ALL,
  rankingListHref,
} from '@/features/ranking/types';
import type { AppRole } from './role';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
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
  | 'programs'
  | 'archive'
  | 'ranking'
  | 'dashboard'
  | null;

const MENU_ICONS: Readonly<Record<string, ShellIconName>> = {
  '/dashboard': 'home',
  '/dashboard/activity': 'chart',
  '/my-repos': 'repo',
  '/staff/dashboard': 'chart',
  '/staff/programs/new': 'detail',
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

const ROLE_GROUP_LABEL: Readonly<Record<AppRole, string>> = {
  STUDENT: '대시보드',
  STAFF: '대시보드',
  ADMIN: '대시보드',
};

const ROLE_MENU: Readonly<Record<AppRole, readonly NavItem[]>> = {
  STUDENT: STUDENT_MENU,
  STAFF: STAFF_MENU,
  ADMIN: ADMIN_MENU,
};

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
    pathname.startsWith('/staff/') ||
    pathname.startsWith('/admin/')
  ) {
    return 'dashboard';
  }
  return null;
}

/**
 * 현재 섹션 하나의 그룹만 반환 (컨텍스트형).
 * 비회원도 programs/archive/ranking 하위는 본다.
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
  switch (section) {
    case 'programs':
      return [programSidebarGroup(options?.programCounts)];
    case 'archive':
      return [archiveSidebarGroup(options?.archiveCounts)];
    case 'ranking':
      return [
        rankingSidebarGroup(
          options?.rankingYears ?? [],
          options?.rankingCounts,
        ),
      ];
    case 'dashboard':
      if (role === null) return [];
      return [
        {
          label: ROLE_GROUP_LABEL[role],
          items: withIcons(ROLE_MENU[role], 0),
        },
      ];
    case null:
      return [];
  }
}

/**
 * 현재 메뉴 강조.
 * `/programs?status=` 는 pathname + search. 상세(`/programs/id`)는 필터 비강조.
 */
export function isCurrentSidebarItem(
  pathname: string,
  href: string,
  search = '',
): boolean {
  const qIndex = href.indexOf('?');
  const hrefPath = qIndex === -1 ? href : href.slice(0, qIndex);
  const hrefQuery = qIndex === -1 ? '' : href.slice(qIndex + 1);

  if (hrefPath === '/programs') {
    if (pathname !== '/programs') return false;
    const wantStatus =
      hrefQuery === ''
        ? 'all'
        : (new URLSearchParams(hrefQuery).get('status') ?? 'all');
    const haveStatus = new URLSearchParams(search).get('status') ?? 'all';
    return wantStatus === haveStatus;
  }

  if (hrefPath === '/archive') {
    if (pathname !== '/archive' && !pathname.startsWith('/archive/')) {
      return false;
    }
    if (pathname !== '/archive') {
      // 상세는 "전체"에만 걸지 않음
      return hrefQuery !== '' && pathname.startsWith('/archive/');
    }
    const want =
      hrefQuery === ''
        ? 'all'
        : (new URLSearchParams(hrefQuery).get('category') ?? 'all');
    const have = new URLSearchParams(search).get('category') ?? 'all';
    return want === have || (want === 'all' && !search.includes('category='));
  }

  if (hrefPath === '/ranking') {
    if (pathname !== '/ranking') return false;
    const want =
      hrefQuery === ''
        ? 'all'
        : (new URLSearchParams(hrefQuery).get('year') ?? 'all');
    const have = new URLSearchParams(search).get('year') ?? 'all';
    return want === have;
  }

  if (pathname === hrefPath) return true;
  // `/dashboard` 는 `/dashboard/activity` 의 부모가 아니다 — 둘 다 사이드 항목.
  if (hrefPath === '/dashboard') return false;
  return pathname.startsWith(`${hrefPath}/`);
}
