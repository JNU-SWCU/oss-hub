import { apiClient } from '@/lib/api-client';

import type {
  RoleRequest,
  RoleSelection,
  RoleSelectionResult,
  StaffRoleRequest,
  StaffRoleRequestDecision,
  StaffRoleRequestListParams,
  StaffRoleRequestPage,
} from './types';

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

export function fetchStaffRoleRequests(
  params: StaffRoleRequestListParams,
): Promise<StaffRoleRequestPage> {
  const search = new URLSearchParams({
    requestedRole: 'STAFF',
    status: params.status,
    query: params.query,
    page: String(params.page),
    limit: String(params.limit),
  });
  return apiClient<StaffRoleRequestPage>(`role-requests?${search.toString()}`);
}

export function decideStaffRoleRequest(
  id: string,
  decision: StaffRoleRequestDecision,
): Promise<StaffRoleRequest> {
  return apiClient<StaffRoleRequest>(
    `role-requests/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    },
  );
}
