import type { NavItem } from '@/components';

/**
 * 공개 화면 메뉴 — 상단 NavBar 단일 원본(#513).
 * 랜딩·업무 화면이 같은 `ShellNav`로 이 목록을 읽는다.
 * 역할 메뉴는 왼쪽 “내 상황” 사이드바(`role-menus.ts`) 몫이다.
 * `/`는 브랜드 링크, `/settings`는 계정 드롭다운.
 */
export const PUBLIC_MENU: NavItem[] = [
  { label: '프로그램', href: '/programs' },
  { label: '공개 아카이브', href: '/archive' },
  { label: '랭킹', href: '/ranking' },
];
