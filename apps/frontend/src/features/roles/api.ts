import { apiClient } from '@/lib/api-client';

import type {
  RoleRequest,
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

/**
 * 내 역할 요청. 요청한 적이 없으면 `null`이다.
 *
 * `signal`을 받는 이유는 화면이 뜨자마자 부르는 자리가 생겼기 때문이다 —
 * 역할 선택 화면이 반려 사유를 읽는다(#673). 그 화면은 사용자가 곧바로 떠날 수
 * 있어(카드를 고르고 제출) 화면이 사라진 뒤 도착한 응답이 이미 없는 컴포넌트의
 * 상태를 건드리는 일을 끊어야 한다. 넘기지 않으면 종전과 같다.
 */
export function fetchMyRoleRequest(
  signal?: AbortSignal,
): Promise<RoleRequest | null> {
  return apiClient<RoleRequest | null>(
    'role-requests/me',
    signal ? { signal } : undefined,
  );
}

export function requestStaffRole(): Promise<RoleRequest> {
  return apiClient<RoleRequest>('role-requests', { method: 'POST' });
}
