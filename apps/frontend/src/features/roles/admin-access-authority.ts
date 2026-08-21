import type { AdminAccessRole } from './admin-access-api';

export type AdminAccessMemberKind = 'STUDENT' | 'STAFF';

export interface AdminAccessAuthority {
  readonly memberKind: AdminAccessMemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
}

export interface AdminAccessAuthoritySource {
  readonly role: AdminAccessRole | null;
  readonly memberKind?: AdminAccessMemberKind | null;
  readonly hasStaffAccess?: boolean;
  readonly hasAdminAccess?: boolean;
}

export function adminAccessAuthority(
  source: AdminAccessAuthoritySource,
): AdminAccessAuthority {
  return {
    memberKind:
      source.memberKind !== undefined
        ? source.memberKind
        : source.role === 'STUDENT' || source.role === 'STAFF'
          ? source.role
          : null,
    hasStaffAccess:
      source.hasStaffAccess !== undefined
        ? source.hasStaffAccess
        : source.role === 'STAFF',
    hasAdminAccess:
      source.hasAdminAccess !== undefined
        ? source.hasAdminAccess
        : source.role === 'ADMIN',
  };
}
