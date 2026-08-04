import type { NavItem } from '@/components';
import {
  PROGRAM_LIST_STATUSES,
  PROGRAM_LIST_STATUS_LABELS,
  programListHref,
  type ProgramListStatus,
} from '@/features/programs/types';
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

/** 자식 상태(들여쓰기). 전체는 부모가 담당. */
const PROGRAM_CHILD_STATUSES = PROGRAM_LIST_STATUSES.filter(
  (s): s is Exclude<ProgramListStatus, 'all'> => s !== 'all',
);

/**
 * 프로그램 메뉴 — 전체(depth 0) + 모집중/진행중/접수대기/종료(depth 1).
 */
export function programSidebarGroup(
  counts?: Partial<Record<ProgramListStatus, number>>,
): SidebarGroup {
  const items: SidebarItem[] = [
    {
      label: PROGRAM_LIST_STATUS_LABELS.all,
      href: programListHref('all'),
      icon: 'list',
      depth: 0,
      count: counts?.all,
    },
    ...PROGRAM_CHILD_STATUSES.map((status) => ({
      label: PROGRAM_LIST_STATUS_LABELS[status],
      href: programListHref(status),
      icon: 'list' as const,
      depth: 1 as const,
      count: counts?.[status],
    })),
  ];
  return { label: '프로그램 메뉴', items };
}

/** @deprecated 테스트 호환 — `programSidebarGroup()` 사용 */
export const PROGRAM_SIDEBAR_GROUP: SidebarGroup = programSidebarGroup();

export const PROGRAM_SIDEBAR_ITEMS: readonly SidebarItem[] =
  PROGRAM_SIDEBAR_GROUP.items;

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
  },
): readonly SidebarGroup[] {
  switch (section) {
    case 'programs':
      return [programSidebarGroup(options?.programCounts)];
    case 'archive':
      return [
        {
          label: '공개 아카이브',
          items: [
            {
              label: '전체',
              href: '/archive',
              icon: 'archive',
              depth: 0,
            },
          ],
        },
      ];
    case 'ranking':
      return [
        {
          label: '랭킹',
          items: [
            {
              label: '전체',
              href: '/ranking',
              icon: 'chart',
              depth: 0,
            },
          ],
        },
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

  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}
