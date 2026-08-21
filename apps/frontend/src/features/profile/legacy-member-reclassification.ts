import type { ProfileMemberKind } from './profile-requirements';
import { toCompleteProfileRequest, validateProfileForm } from './profile-state';
import type { ProfileFormValues } from './types';

export type LegacyMemberReclassificationAccess = {
  readonly status:
    'loading' | 'error' | 'anonymous' | 'unassigned' | 'assigned';
  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly memberKind: ProfileMemberKind | null;
  readonly hasAdminAccess: boolean;
};

export type LegacyMemberReclassificationRequest = {
  readonly memberKind: ProfileMemberKind;
  readonly name: string;
  readonly affiliationKind: 'DEPARTMENT' | 'PROGRAM_OFFICE';
  readonly affiliationName: string;
  readonly studentId?: string;
};

export function requiresLegacyMemberReclassification(
  access: LegacyMemberReclassificationAccess,
): boolean {
  return (
    access.status === 'assigned' &&
    access.role === 'ADMIN' &&
    access.hasAdminAccess &&
    access.memberKind === null
  );
}

export function toLegacyMemberReclassificationRequest(
  values: ProfileFormValues,
  memberKind: ProfileMemberKind,
): LegacyMemberReclassificationRequest | null {
  if (
    Object.values(validateProfileForm(values, memberKind)).some(
      (error) => error !== null,
    )
  ) {
    return null;
  }
  const profile = toCompleteProfileRequest(values, memberKind);
  return profile === null ? null : { memberKind, ...profile };
}
