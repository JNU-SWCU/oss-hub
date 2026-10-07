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
