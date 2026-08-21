import { apiClient } from '@/lib/api-client';
import type { ProfileMemberKind } from './profile-requirements';
import type { LegacyMemberReclassificationRequest } from './legacy-member-reclassification';

export type LegacyMemberReclassificationResponse = {
  readonly memberKind: ProfileMemberKind;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: true;
};

export async function reclassifyLegacyMember(
  request: LegacyMemberReclassificationRequest,
): Promise<LegacyMemberReclassificationResponse> {
  return parseResponse(
    await apiClient<unknown>('users/me/legacy-member-reclassification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}

function parseResponse(value: unknown): LegacyMemberReclassificationResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('회원 재분류 응답 형식이 올바르지 않습니다.');
  }
  const record = Object.fromEntries(Object.entries(value));
  if (
    (record.memberKind !== 'STUDENT' && record.memberKind !== 'STAFF') ||
    typeof record.hasStaffAccess !== 'boolean' ||
    record.hasAdminAccess !== true
  ) {
    throw new TypeError('회원 재분류 응답 형식이 올바르지 않습니다.');
  }
  return {
    memberKind: record.memberKind,
    hasStaffAccess: record.hasStaffAccess,
    hasAdminAccess: true,
  };
}
