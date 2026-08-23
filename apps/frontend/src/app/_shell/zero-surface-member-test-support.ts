import type { StaffAccessRequest } from '@/features/roles/types';
import type { MemberAccess } from './member-access';

/**
 * 면이 없는 회원 라우팅 검사가 함께 쓰는 픽스처.
 *
 * 분류(`zero-surface-member-classification.test.tsx`)와 화면 도달
 * (`zero-surface-member-reach.test.tsx`)을 두 파일로 나눠 두고, 그 둘이 **같은
 * 사람**을 검사한다는 사실은 여기서 한 벌로 지킨다. 픽스처를 각자 적어 두면 한쪽만
 * 고쳐졌을 때 "분류는 고쳤는데 화면은 옛 사람으로 검사하는" 상태가 조용히 통과한다.
 *
 * `vi.mock`은 파일마다 끌어올려지므로 가짜는 여기 두지 않는다 — 여기 있는 것은
 * 값뿐이다.
 */

/** 면이 하나도 없는 교직원 — 유형은 남아 있고 권한만 없다. */
export const ZERO_SURFACE_STAFF: MemberAccess = {
  memberKind: 'STAFF',
  hasStaffAccess: false,
  hasAdminAccess: false,
};

/**
 * 지금도 `assigned`여야 하는 사람들 — 이 목록이 줄어들면 회귀다.
 *
 * 면을 얻는 근거가 셋 다 다르다: 학생은 유형으로, 승인된 교직원은
 * `hasStaffAccess`로, 관리자는 `hasAdminAccess`로 얻는다. 셋을 함께 두는 이유는
 * 분류가 어느 한 근거로 좁아지는 순간을 잡기 위해서다.
 */
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

/** 권한 안내 화면의 제목 — 면이 없는 회원에게는 어느 경로에서도 떠서는 안 된다. */
export const ACCESS_DENIED_HEADING = '접근 권한이 없는 페이지 입니다';

/** `/auth/session`이 내려 주는 인증 세션 모양. */
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
