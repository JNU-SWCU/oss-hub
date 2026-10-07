import type { StaffAccessRequest } from '@/features/roles/types';
import type { MemberAccess } from './member-access';

export const ZERO_SURFACE_STAFF: MemberAccess = {
  memberKind: 'STAFF',
  hasStaffAccess: false,
  hasAdminAccess: false,
};

export const ASSIGNED_PERSONAS = [
  [
    'STUDENT',
    { memberKind: 'STUDENT', hasStaffAccess: false, hasAdminAccess: false },
  ],
  [
    '승인된 STAFF',
    { memberKind: 'STAFF', hasStaffAccess: true, hasAdminAccess: false },
  ],
  [
    '관리자 전용 계정',
    { memberKind: null, hasStaffAccess: false, hasAdminAccess: true },
  ],
  [
    '학생 관리자',
    { memberKind: 'STUDENT', hasStaffAccess: false, hasAdminAccess: true },
  ],
] as const satisfies readonly (readonly [string, MemberAccess])[];

export const ACCESS_DENIED_HEADING = '접근 권한이 없는 페이지 입니다';

export function authenticatedSession(access: MemberAccess) {
  return {
    status: 'authenticated' as const,
    user: {
      nickname: 'synthetic-member',
      name: '합성 사용자',
      email: null,
      avatarUrl: null,
      ...access,
      isProfileComplete: true,
    },
    retry: () => {},
  };
}

export function staffAccessRequest(
  overrides: Partial<StaffAccessRequest> = {},
): StaffAccessRequest {
  return {
    requestedRole: 'STAFF',
    status: 'PENDING',
    requestedAt: '2026-07-30T02:00:00.000Z',
    decidedAt: null,
    rejectionReason: null,
    ...overrides,
  };
}
