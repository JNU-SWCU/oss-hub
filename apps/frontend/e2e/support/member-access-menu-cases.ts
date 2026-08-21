import type { SyntheticAuthority } from './member-access-fixture';

export interface MenuCase {
  readonly name: string;
  readonly path: string;
  readonly authority: SyntheticAuthority;
  readonly visible: readonly string[];
  readonly hidden: readonly string[];
}

export const UNIONED_MENU_CASES: readonly MenuCase[] = [
  {
    name: 'student',
    path: '/dashboard/activity',
    authority: {
      role: 'STUDENT',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
    visible: ['내 대시보드', '내 저장소', '내 활동'],
    hidden: ['운영 대시보드', '사용자 목록'],
  },
  {
    name: 'staff-approved',
    path: '/dashboard/insights',
    authority: {
      role: 'STAFF',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: false,
    },
    visible: ['운영 대시보드', '학생 활성', '가입 신청'],
    hidden: ['내 활동', '사용자 목록'],
  },
  {
    name: 'student-admin',
    path: '/dashboard/activity',
    authority: {
      role: 'STUDENT',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: true,
    },
    visible: ['내 활동', '사용자 목록', '감사 로그', '시스템 상태'],
    hidden: ['운영 대시보드'],
  },
  {
    name: 'staff-admin',
    path: '/dashboard/insights',
    authority: {
      role: 'ADMIN',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
    },
    visible: ['운영 대시보드', '가입 신청', '사용자 목록', '감사 로그'],
    hidden: ['내 활동'],
  },
] as const;
