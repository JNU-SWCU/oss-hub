import type { NavItem } from '@/components';

export const STUDENT_MENU: NavItem[] = [
  { label: '내 대시보드', href: '/dashboard' },
  { label: '내 저장소', href: '/my-repos' },
  { label: '내 활동', href: '/dashboard/activity' },
];

export const STAFF_MENU: NavItem[] = [
  { label: '운영 대시보드', href: '/dashboard' },
  { label: '학생 활성', href: '/dashboard/insights' },
  { label: '가입 신청', href: '/dashboard/applicants' },
];

export const ADMIN_SYSTEM_MENU: NavItem[] = [
  { label: '사용자 목록', href: '/dashboard/users' },
  { label: '감사 로그', href: '/dashboard/audit-logs' },
  { label: '시스템 상태', href: '/dashboard/system-status' },
];

export const ADMIN_MENU: NavItem[] = [...STAFF_MENU, ...ADMIN_SYSTEM_MENU];
