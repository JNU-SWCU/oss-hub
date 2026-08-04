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
  { label: '운영 대시보드', href: '/staff/dashboard' },
  { label: '프로그램 등록', href: '/staff/programs/new' },
];

export const ADMIN_MENU: NavItem[] = [
  { label: '관리 콘솔', href: '/admin/access' },
  { label: '감사 로그', href: '/admin/audit-log' },
  { label: '시스템 상태', href: '/admin/system-status' },
];
