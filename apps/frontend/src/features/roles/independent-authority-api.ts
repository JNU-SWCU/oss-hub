import { apiClient } from '@/lib/api-client';
import {
  AdminAccessResponseError,
  parseAdminAccessDetail,
  type AdminAccessDetail,
  type AdminAccessRole,
} from './admin-access-api';

export type AdminMemberKind = 'STUDENT' | 'STAFF';
export type AdminAuthorityCommand =
  'GRANT_ADMIN_ACCESS' | 'REVOKE_ADMIN_ACCESS';

export interface MemberKindMutationFields {
  readonly studentId?: string;
  readonly department?: string;
  readonly staffNumber?: string | null;
}

export interface MemberKindMutationRequest extends MemberKindMutationFields {
  readonly memberKind: AdminMemberKind;
  readonly expectedMemberKind: AdminMemberKind;
  readonly expectedHasStaffAccess: boolean;
}

export interface IndependentAuthority {
  readonly memberKind: AdminMemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
}

export type CanonicalAdminAccessProfile = AdminAccessDetail['profile'] & {
  readonly staffNumber: string | null;
};

export interface CanonicalAdminAccessDetail
  extends Omit<AdminAccessDetail, 'profile'>, IndependentAuthority {
  readonly profile: CanonicalAdminAccessProfile;
}

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
  const detail = parseAdminAccessDetail(value);
  if (
    !isRecord(value) ||
    !isRecord(value.profile) ||
    !(
      value.profile.staffNumber === null ||
      typeof value.profile.staffNumber === 'string'
    )
  ) {
    throw new AdminAccessResponseError();
  }
  return {
    ...detail,
    profile: {
      ...detail.profile,
      staffNumber: value.profile.staffNumber,
    },
    ...parseAuthority(value),
  };
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

async function patchIndependentMutation(
  id: string,
  path: 'member-kind' | 'admin-access',
  body: MemberKindMutationRequest | { readonly command: AdminAuthorityCommand },
  signal?: AbortSignal,
): Promise<IndependentAuthorityMutationResponse> {
  const value = await apiClient<unknown>(
    `users/${encodeURIComponent(id)}/${path}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    },
  );
  return parseIndependentAuthorityMutationResponse(value);
}

export function patchMemberKind(
  id: string,
  request: MemberKindMutationRequest,
  signal?: AbortSignal,
): Promise<IndependentAuthorityMutationResponse> {
  return patchIndependentMutation(id, 'member-kind', request, signal);
}

export function patchAdminAuthority(
  id: string,
  command: AdminAuthorityCommand,
  signal?: AbortSignal,
): Promise<IndependentAuthorityMutationResponse> {
  return patchIndependentMutation(id, 'admin-access', { command }, signal);
}
