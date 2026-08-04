import type { NavItem } from '@/components';
import {
  PROGRAM_LIST_STATUSES,
  PROGRAM_LIST_STATUS_LABELS,
  programListHref,
} from '@/features/programs/types';
import type { AppRole } from './role';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import type { ShellIconName } from './shell-icons';

/**
 * 왼쪽 사이드 패널.
 * - **프로그램 메뉴**: 모집·진행·접수대기·종료 탑다운 (공개 카탈로그, 연습대회 없음)
 * - **내 상황**: 가입 완료 역할 홈 (`role-menus.ts`)
 * 상단 Nav의 공개 아카이브·랭킹·설정은 여기 두지 않는다.
 */
export interface SidebarItem extends NavItem {
  readonly icon: ShellIconName;
}

export interface SidebarGroup {
  readonly label: string;
  readonly items: readonly SidebarItem[];
}

const MENU_ICONS: Readonly<Record<string, ShellIconName>> = {
  '/dashboard': 'home',
  '/my-repos': 'repo',
  '/staff/dashboard': 'chart',
  '/staff/programs/new': 'detail',
  '/admin/access': 'people',
  '/admin/audit-log': 'shield',
  '/admin/system-status': 'pulse',
  '/programs': 'list',
};

const FALLBACK_ICON: ShellIconName = 'detail';

function withIcons(items: readonly NavItem[]): readonly SidebarItem[] {
  return items.map((item) => ({
    ...item,
    icon: MENU_ICONS[item.href.split('?')[0] ?? item.href] ?? FALLBACK_ICON,
  }));
}

/**
 * 데이커형 프로그램 탑다운 — 라벨은 `PROGRAM_LIST_STATUS_LABELS` 원본.
 * 순서는 전체 → 모집중 → 진행중 → 접수대기 → 종료.
 */
export const PROGRAM_SIDEBAR_ITEMS: readonly SidebarItem[] =
  PROGRAM_LIST_STATUSES.map((status) => ({
    label: PROGRAM_LIST_STATUS_LABELS[status],
    href: programListHref(status),
    icon: 'list' as const,
  }));

export const PROGRAM_SIDEBAR_GROUP: SidebarGroup = {
  label: '프로그램 메뉴',
  items: PROGRAM_SIDEBAR_ITEMS,
};

const ROLE_GROUP_LABEL: Readonly<Record<AppRole, string>> = {
  STUDENT: '내 상황',
  STAFF: '운영',
  ADMIN: '관리',
};

const ROLE_MENU: Readonly<Record<AppRole, readonly NavItem[]>> = {
  STUDENT: STUDENT_MENU,
  STAFF: STAFF_MENU,
  ADMIN: ADMIN_MENU,
};

/**
 * 사이드 패널 구성.
 * 프로그램 메뉴는 **항상**(비회원 포함). 역할 메뉴는 가입 완료 시에만.
 */
export function sidebarGroupsFor(
  role: AppRole | null,
): readonly SidebarGroup[] {
  if (role === null) {
    return [PROGRAM_SIDEBAR_GROUP];
  }
  return [
    PROGRAM_SIDEBAR_GROUP,
    {
      label: ROLE_GROUP_LABEL[role],
      items: withIcons(ROLE_MENU[role]),
    },
  ];
}

/**
 * 현재 메뉴 강조.
 * `/programs?status=` 는 pathname + search 로 맞춘다. 상세(`/programs/id`)는
 * 상태 필터를 켜지 않는다.
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

  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}
