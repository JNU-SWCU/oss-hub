import type { MemberKind } from '@prisma/client';
import type { AuthorityLabel } from './authority-label';

export const STAFF_ACCESS_COMMANDS = {
  GRANT: 'GRANT_STAFF_ACCESS',
  REVOKE: 'REVOKE_STAFF_ACCESS',
} as const;

export const ADMIN_ACCESS_COMMANDS = {
  GRANT: 'GRANT_ADMIN_ACCESS',
  REVOKE: 'REVOKE_ADMIN_ACCESS',
} as const;

export type GrantStaffAccessCommand = {
  readonly command: typeof STAFF_ACCESS_COMMANDS.GRANT;
};

export type RevokeStaffAccessCommand = {
  readonly command: typeof STAFF_ACCESS_COMMANDS.REVOKE;
};

export type StaffAccessMutationCommand =
  GrantStaffAccessCommand | RevokeStaffAccessCommand;

export type GrantAdminAccessCommand = {
  readonly command: typeof ADMIN_ACCESS_COMMANDS.GRANT;
};

export type RevokeAdminAccessCommand = {
  readonly command: typeof ADMIN_ACCESS_COMMANDS.REVOKE;
};

export type AdminAuthorityMutationCommand =
  GrantAdminAccessCommand | RevokeAdminAccessCommand;

export type IndependentAuthorityMutationResult = {
  readonly id: string;
  readonly role: AuthorityLabel | null;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};
