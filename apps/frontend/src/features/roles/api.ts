import { apiClient } from '@/lib/api-client';

import type { RoleRequest, RoleSelection, RoleSelectionResult } from './types';

export function selectRole(
  selectedRole: RoleSelection,
): Promise<RoleSelectionResult> {
  return apiClient<RoleSelectionResult>('onboarding/role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedRole }),
  });
}

export function fetchMyRoleRequest(): Promise<RoleRequest | null> {
  return apiClient<RoleRequest | null>('role-requests/me');
}

export function requestStaffRole(): Promise<RoleRequest> {
  return apiClient<RoleRequest>('role-requests', { method: 'POST' });
}
