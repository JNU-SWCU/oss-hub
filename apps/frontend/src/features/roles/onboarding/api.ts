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

interface MyStaffAccessRequestResponse {
  readonly status: 'NONE' | StaffAccessRequest['status'];
  readonly request: StaffAccessRequest | null;
}

export async function fetchMyStaffAccessRequest(): Promise<StaffAccessRequest | null> {
  const body =
    await apiClient<MyStaffAccessRequestResponse>('role-requests/me');
  return body.request;
}

export function requestStaffRole(): Promise<StaffAccessRequest> {
  return apiClient<StaffAccessRequest>('role-requests', { method: 'POST' });
}
