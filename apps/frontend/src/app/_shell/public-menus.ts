import type { NavItem } from '@/components';

/**
 * 공개 화면 메뉴 — 랜딩 헤더(`layout.tsx`)와 업무 사이드바(`sidebar-menu.ts`)가
 * 함께 읽는 라벨·경로 단일 원본이다(#513). 사이드바는 아이콘·묶음만 얹는다.
 * `/`는 목록에 없다 — 두 셸 모두 브랜드가 이미 `/` 링크다.
 * 역할 메뉴(`role-menus.ts`)·계정 묶음은 사이드바 전용이다(#512).
 */
export const PUBLIC_MENU: NavItem[] = [
  { label: '프로그램', href: '/programs' },
  { label: '공개 아카이브', href: '/archive' },
  { label: '랭킹', href: '/ranking' },
];
