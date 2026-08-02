import type { NavItem } from '@/components';
import { PUBLIC_MENU } from './public-menus';
import type { AppRole } from './role';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import type { ShellIconName } from './shell-icons';

/**
 * 사이드바 메뉴 — 라벨·경로의 단일 원본은 역할 메뉴가 `role-menus.ts`, 공개 화면이
 * `public-menus.ts`다(#513). 이 파일은 거기에 아이콘과 묶음(그룹)만 얹는다.
 * 메뉴 문구를 여기서 다시 적으면 두 곳이 갈라진다.
 */
export interface SidebarItem extends NavItem {
  readonly icon: ShellIconName;
}

export interface SidebarGroup {
  readonly label: string;
  readonly items: readonly SidebarItem[];
}

/**
 * 메뉴 경로 → 아이콘. 경로를 키로 잡아 원본 목록이 메뉴를 늘려도 라벨이 아니라
 * 경로만 여기 추가하면 된다. 빠진 경로는 아래 기본값으로 떨어진다.
 */
const MENU_ICONS: Readonly<Record<string, ShellIconName>> = {
  '/dashboard': 'home',
  '/my-repos': 'repo',
  '/staff/dashboard': 'chart',
  '/staff/programs/new': 'detail',
  // 교직원 승인·사용자 관리가 관리자 접근 한 화면으로 합쳐졌다.
  '/admin/access': 'people',
  '/admin/audit-log': 'shield',
  '/admin/system-status': 'pulse',
  // 공개 화면
  '/programs': 'list',
  '/archive': 'archive',
  // 활동량 집계라 막대 그래프다. `운영 대시보드`와 겹치지만 남은 아이콘은 뜻이 맞지 않는다.
  '/ranking': 'chart',
};

const FALLBACK_ICON: ShellIconName = 'detail';

function withIcons(items: readonly NavItem[]): readonly SidebarItem[] {
  return items.map((item) => ({
    ...item,
    icon: MENU_ICONS[item.href] ?? FALLBACK_ICON,
  }));
}

/**
 * 공개 화면 — 로그인 없이도 볼 수 있으므로 **세 역할 모두**에게 보인다.
 * (시안 v1에서 이 묶음을 역할 메뉴로 착각해 빼먹었다가 지적받은 부분이다.)
 * 항목은 `public-menus.ts`가 정한다 — 랜딩 헤더가 읽는 목록과 같다.
 */
export const PUBLIC_GROUP: SidebarGroup = {
  label: '둘러보기',
  items: withIcons(PUBLIC_MENU),
};

/** 계정 묶음 — `/settings`는 로그인만 요구하는 공용 화면이다(AuthGate). */
const ACCOUNT_GROUP: SidebarGroup = {
  label: '계정',
  items: [{ label: '설정', href: '/settings', icon: 'gear' }],
};

const ROLE_GROUP_LABEL: Readonly<Record<AppRole, string>> = {
  STUDENT: '내 작업',
  STAFF: '운영',
  ADMIN: '관리',
};

const ROLE_MENU: Readonly<Record<AppRole, readonly NavItem[]>> = {
  STUDENT: STUDENT_MENU,
  STAFF: STAFF_MENU,
  ADMIN: ADMIN_MENU,
};

/**
 * 역할별 사이드바 구성. 역할을 아직 모르는 사용자(비로그인·조회 중·역할 미배정)는
 * 공개 묶음만 본다 — 로그인해야 열리는 메뉴를 미리 보여 주면 눌렀을 때 튕긴다.
 */
export function sidebarGroupsFor(
  role: AppRole | null,
): readonly SidebarGroup[] {
  if (role === null) {
    return [PUBLIC_GROUP];
  }
  return [
    { label: ROLE_GROUP_LABEL[role], items: withIcons(ROLE_MENU[role]) },
    PUBLIC_GROUP,
    ACCOUNT_GROUP,
  ];
}

/** 상단바 breadcrumb 후보 — 모든 역할의 메뉴를 합친 경로→라벨 표. */
const ALL_LABELS: ReadonlyArray<readonly [string, string]> = [
  ...STUDENT_MENU,
  ...STAFF_MENU,
  ...ADMIN_MENU,
  ...PUBLIC_GROUP.items,
  ...ACCOUNT_GROUP.items,
].map((item) => [item.href, item.label] as const);

/**
 * 현재 경로가 어느 메뉴에 속하는지. 상세 화면(`/programs/xxx`)은 목록 메뉴에
 * 속하므로 **가장 긴 접두사**가 이긴다 — 짧은 쪽이 먼저 걸리면 `/admin/access`가
 * 늘 `/admin`류 첫 항목으로 표시된다.
 */
export function shellPageLabel(pathname: string): string | null {
  let best: readonly [string, string] | null = null;
  for (const entry of ALL_LABELS) {
    const [href] = entry;
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (best === null || href.length > best[0].length) best = entry;
  }
  return best?.[1] ?? null;
}

/** 사이드바에서 현재 위치로 볼 항목인지. breadcrumb과 같은 규칙을 쓴다. */
export function isCurrentSidebarItem(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
