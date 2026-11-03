import { apiClient } from '@/lib/api-client';
import { isRecord } from '@/lib/is-record';
import type {
  AdminApprovalState,
  AdminApprovalStatus,
} from './admin-access-api-types';
import { hasAdminApprovalState } from './admin-access-response-guards';
import {
  AdminAccessResponseError,
  parseAdminAccessDetail,
  type AdminAccessListItem,
  type AdminAccessDetail,
  type AdminAccessRole,
} from './admin-access-api';

type AdminMemberKind = 'STUDENT' | 'STAFF';
export type AdminAuthorityCommand =
  'GRANT_ADMIN_ACCESS' | 'REVOKE_ADMIN_ACCESS';

export interface MemberKindMutationRequest {
  readonly expectedMemberKind: AdminMemberKind;
  readonly expectedApprovalStatus: AdminApprovalStatus;
  readonly expectedApprovalRequestId: string | null;
}

interface IndependentAuthority {
  readonly memberKind: AdminMemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
}

export type AdminAccessDirectoryItem = AdminAccessListItem &
  IndependentAuthority &
  AdminApprovalState;

export function isAdminAccessDirectoryItem(
  item: AdminAccessListItem,
): item is AdminAccessDirectoryItem {
  return (
    hasAdminApprovalState(item) &&
    'memberKind' in item &&
    (item.memberKind === null || isMemberKind(item.memberKind)) &&
    'hasStaffAccess' in item &&
    typeof item.hasStaffAccess === 'boolean' &&
    'hasAdminAccess' in item &&
    typeof item.hasAdminAccess === 'boolean'
  );
}

type CanonicalAdminAccessProfile = AdminAccessDetail['profile'] & {
  readonly staffNumber: string | null;
};

export interface CanonicalAdminAccessDetail
  extends
    Omit<AdminAccessDetail, 'profile'>,
    IndependentAuthority,
    AdminApprovalState {
  readonly profile: CanonicalAdminAccessProfile;
}

export interface IndependentAuthorityMutationResponse
  extends IndependentAuthority, AdminApprovalState {
  readonly id: string;
  readonly role: AdminAccessRole | null;
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
    !hasAdminApprovalState(value) ||
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
    approvalStatus: value.approvalStatus,
    approvalRequestId: value.approvalRequestId,
    profile: {
      ...detail.profile,
      staffNumber: value.profile.staffNumber,
    },
    ...parseAuthority(value),
  };
}

function parseIndependentAuthorityMutationResponse(
  value: unknown,
): IndependentAuthorityMutationResponse {
  if (
    !isRecord(value) ||
    !hasAdminApprovalState(value) ||
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
    approvalStatus: value.approvalStatus,
    approvalRequestId: value.approvalRequestId,
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
  path: 'member-kind/reset' | 'admin-access',
  body: MemberKindMutationRequest | { readonly command: AdminAuthorityCommand },
  signal?: AbortSignal,
): Promise<IndependentAuthorityMutationResponse> {
  const value = await apiClient<unknown>(
    `users/${encodeURIComponent(id)}/${path}`,
    {
      method: path === 'member-kind/reset' ? 'POST' : 'PATCH',
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    },
  );
  return parseIndependentAuthorityMutationResponse(value);
}

export function resetMemberKind(
  id: string,
  request: MemberKindMutationRequest,
  signal?: AbortSignal,
): Promise<IndependentAuthorityMutationResponse> {
  return patchIndependentMutation(id, 'member-kind/reset', request, signal);
}

export function patchAdminAuthority(
  id: string,
  command: AdminAuthorityCommand,
  signal?: AbortSignal,
): Promise<IndependentAuthorityMutationResponse> {
  return patchIndependentMutation(id, 'admin-access', { command }, signal);
}
