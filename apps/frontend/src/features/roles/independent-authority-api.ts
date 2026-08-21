import { apiClient } from '@/lib/api-client';
import {
  AdminAccessResponseError,
  parseAdminAccessDetail,
  type AdminAccessDetail,
  type AdminAccessRole,
} from './admin-access-api';

export type AdminMemberKind = 'STUDENT' | 'STAFF';
export type StaffAccessCommand = 'GRANT_STAFF_ACCESS' | 'REVOKE_STAFF_ACCESS';
export type AdminAuthorityCommand =
  'GRANT_ADMIN_ACCESS' | 'REVOKE_ADMIN_ACCESS';

export interface IndependentAuthority {
  readonly memberKind: AdminMemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
}

export interface CanonicalAdminAccessDetail
  extends AdminAccessDetail, IndependentAuthority {}

export interface IndependentAuthorityMutationResponse extends IndependentAuthority {
  readonly id: string;
  readonly role: AdminAccessRole | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMemberKind(value: unknown): value is AdminMemberKind {
  return value === 'STUDENT' || value === 'STAFF';
}

function parseAuthority(value: unknown): IndependentAuthority {
  if (
    !isRecord(value) ||
    !(value.memberKind === null || isMemberKind(value.memberKind)) ||
    typeof value.hasStaffAccess !== 'boolean' ||
    typeof value.hasAdminAccess !== 'boolean'
  ) {
    throw new AdminAccessResponseError();
  }
  return {
    memberKind: value.memberKind,
    hasStaffAccess: value.hasStaffAccess,
    hasAdminAccess: value.hasAdminAccess,
  };
}

export function parseCanonicalAdminAccessDetail(
  value: unknown,
): CanonicalAdminAccessDetail {
  return { ...parseAdminAccessDetail(value), ...parseAuthority(value) };
}

export function parseIndependentAuthorityMutationResponse(
  value: unknown,
): IndependentAuthorityMutationResponse {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    !(
      value.role === null ||
      value.role === 'STUDENT' ||
      value.role === 'STAFF' ||
      value.role === 'ADMIN'
    )
  ) {
    throw new AdminAccessResponseError();
  }
  return {
    id: value.id,
    role: value.role,
    ...parseAuthority(value),
  };
}

export async function fetchCanonicalAdminAccessDetail(
  id: string,
  signal?: AbortSignal,
): Promise<CanonicalAdminAccessDetail> {
  const value = await apiClient<unknown>(
    `users/${encodeURIComponent(id)}/access`,
    signal ? { signal } : undefined,
  );
  return parseCanonicalAdminAccessDetail(value);
}

async function patchAuthority(
  id: string,
  path: 'staff-access' | 'admin-access',
  command: StaffAccessCommand | AdminAuthorityCommand,
  signal?: AbortSignal,
): Promise<IndependentAuthorityMutationResponse> {
  const value = await apiClient<unknown>(
    `users/${encodeURIComponent(id)}/${path}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
      ...(signal ? { signal } : {}),
    },
  );
  return parseIndependentAuthorityMutationResponse(value);
}

export function patchStaffAccess(
  id: string,
  command: StaffAccessCommand,
  signal?: AbortSignal,
): Promise<IndependentAuthorityMutationResponse> {
  return patchAuthority(id, 'staff-access', command, signal);
}

export function patchAdminAuthority(
  id: string,
  command: AdminAuthorityCommand,
  signal?: AbortSignal,
): Promise<IndependentAuthorityMutationResponse> {
  return patchAuthority(id, 'admin-access', command, signal);
}
