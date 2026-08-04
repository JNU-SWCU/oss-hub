import type { NavItem } from '@/components';

/**
 * 상단 Nav 공개 3종 — 누구나. 4번째 "대시보드"는 `AppFrame`이 가입 완료 시 붙인다.
 * 좌측 패널은 섹션 하위(`sidebar-menu.ts`) 전용.
 */
export const PUBLIC_MENU: NavItem[] = [
  { label: '프로그램', href: '/programs' },
  { label: '공개 아카이브', href: '/archive' },
  { label: '랭킹', href: '/ranking' },
];
