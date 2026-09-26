import type { MemberKind } from '@prisma/client';
import type { IndependentAuthorityMutationResult } from './independent-authority';

export const MEMBER_KINDS = {
  STUDENT: 'STUDENT',
  STAFF: 'STAFF',
} as const satisfies Record<MemberKind, MemberKind>;

export type MemberKindMutationCommand = {
  readonly memberKind: MemberKind;
  readonly expectedMemberKind: MemberKind;
  readonly expectedHasStaffAccess: boolean;
  readonly studentId?: string;
  readonly department?: string;
  readonly staffNumber?: string | null;
};

export type MemberKindMutationResult = IndependentAuthorityMutationResult;

export function normalizeStaffNumber(value: string): string {
  return value.trim().normalize('NFC');
}

export function isValidStaffNumber(value: string): boolean {
  const normalized = normalizeStaffNumber(value);
  const codePointCount = Array.from(normalized).length;
  return codePointCount >= 1 && codePointCount <= 100;
}
