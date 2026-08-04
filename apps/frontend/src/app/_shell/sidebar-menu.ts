import type { NavItem } from '@/components';
import type { AppRole } from './role';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import type { ShellIconName } from './shell-icons';

/**
 * 왼쪽 “내 상황” 사이드바 — 라벨·경로 원본은 `role-menus.ts`다.
 * 공개 화면(프로그램·아카이브·랭킹)은 상단 `PUBLIC_MENU` 전담이라 여기 넣지 않는다.
 * 설정은 계정 드롭다운 몫이다.
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
};

const FALLBACK_ICON: ShellIconName = 'detail';

function withIcons(items: readonly NavItem[]): readonly SidebarItem[] {
  return items.map((item) => ({
    ...item,
    icon: MENU_ICONS[item.href] ?? FALLBACK_ICON,
  }));
}

/** 사이드바 구역 제목 — 역할별 “내 상황” 묶음. */
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
 * 가입을 마친 역할의 “내 상황” 메뉴만 반환한다.
 * 역할이 없으면 빈 배열 — 사이드바 자체를 달지 않는다.
 */
export function sidebarGroupsFor(
  role: AppRole | null,
): readonly SidebarGroup[] {
  if (role === null) {
    return [];
  }
  return [
    {
      label: ROLE_GROUP_LABEL[role],
      items: withIcons(ROLE_MENU[role]),
    },
  ];
}

/** 사이드바에서 현재 위치로 볼 항목인지. */
export function isCurrentSidebarItem(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
