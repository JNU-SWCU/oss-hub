import type { NavItem } from '@/components';

/**
 * 역할별 좌측 패널 메뉴(#136 최소 요구 3). id를 필요로 하는 문맥적 경로
 * (신청 #104·마일스톤 제출 #115·제출물 검토 #125)는 프로그램·마일스톤·제출물
 * 상세에서 진입하는 흐름이라 고정 메뉴에 넣지 않는다.
 */
export const STUDENT_MENU: NavItem[] = [
  { label: '내 대시보드', href: '/dashboard' },
  { label: '내 저장소', href: '/my-repos' },
];

export const STAFF_MENU: NavItem[] = [
  { label: '운영 대시보드', href: '/staff/dashboard' },
  { label: '프로그램 등록', href: '/staff/programs/new' },
];

export const ADMIN_MENU: NavItem[] = [
  { label: '교직원 승인', href: '/admin/staff-requests' },
  { label: '관리 콘솔', href: '/admin/users' },
  { label: '감사 로그', href: '/admin/audit-log' },
  { label: '시스템 상태', href: '/admin/system-status' },
];
