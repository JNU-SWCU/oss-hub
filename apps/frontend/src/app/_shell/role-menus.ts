import type { NavItem } from '@/components';

/**
 * 역할별 좌측 패널 메뉴 — 상단 waypoint + 섹션 사이드 패널 전용.
 * 화면 안 PageHeader actions로 같은 목적지를 다시 두지 않는다.
 * id 문맥 경로(신청·제출·검토)는 상세 흐름에서만 진입한다.
 */
export const STUDENT_MENU: NavItem[] = [
  { label: '내 대시보드', href: '/dashboard' },
  { label: '내 저장소', href: '/my-repos' },
  { label: '내 활동', href: '/dashboard/activity' },
];

export const STAFF_MENU: NavItem[] = [
  // 입구 URL은 회원 공통 `/dashboard`. 본문만 세션 역할(STAFF)로 갈린다.
  { label: '운영 대시보드', href: '/dashboard' },
];

export const ADMIN_MENU: NavItem[] = [
  // 입구 URL은 회원 공통 `/dashboard`. 본문만 세션 역할(ADMIN)로 갈린다.
  // `/admin/access` 물리 경로·모달 intercept는 deep link로 당분간 유지한다.
  { label: '관리 콘솔', href: '/dashboard' },
  { label: '접근 목록', href: '/admin/access' },
  { label: '감사 로그', href: '/admin/audit-log' },
  { label: '시스템 상태', href: '/admin/system-status' },
];
