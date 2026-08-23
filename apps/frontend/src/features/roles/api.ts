import { apiClient } from '@/lib/api-client';

import type {
  StaffAccessRequest,
  RoleSelection,
  RoleSelectionResult,
  RoleSelectionState,
} from './types';

const SELECTABLE_ROLES: readonly RoleSelection[] = ['STUDENT', 'STAFF'];

export function selectRole(
  selectedRole: RoleSelection,
): Promise<RoleSelectionResult> {
  return apiClient<RoleSelectionResult>('onboarding/role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedRole }),
  });
}

/**
 * 지금 고른 역할을 읽는다.
 *
 * 값을 그대로 믿지 않고 **아는 값만 통과시킨다.** 이 값이 프로필 화면의 필수 항목을
 * 정하기 때문이다 — 모르는 문자열이 흘러 들어오면 화면은 그것을 "어떤 역할"로 취급해
 * 필수 항목을 잘못 계산한다. 모르는 값은 `null`로 접어 "아직 고르지 않음"과 같게 보고,
 * 그 사용자는 역할 선택 화면으로 되돌아간다 — 다시 고르면 되는 자리다.
 */
export async function fetchMyRoleSelection(
  signal?: AbortSignal,
): Promise<RoleSelectionState> {
  const body = await apiClient<unknown>(
    'onboarding/role',
    signal ? { signal } : undefined,
  );
  const selectedRole =
    typeof body === 'object' && body !== null
      ? (body as { readonly selectedRole?: unknown }).selectedRole
      : undefined;
  return {
    selectedRole:
      SELECTABLE_ROLES.find((role) => role === selectedRole) ?? null,
  };
}

export function fetchMyStaffAccessRequest(): Promise<StaffAccessRequest | null> {
  return apiClient<StaffAccessRequest | null>('role-requests/me');
}

export function requestStaffRole(): Promise<StaffAccessRequest> {
  return apiClient<StaffAccessRequest>('role-requests', { method: 'POST' });
}
