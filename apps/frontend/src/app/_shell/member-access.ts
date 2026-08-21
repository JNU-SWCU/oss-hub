export type MemberKind = 'STUDENT' | 'STAFF';
export type MemberSurface = 'student' | 'staff' | 'admin';

export interface MemberAccess {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
}

export const EMPTY_MEMBER_ACCESS: MemberAccess = {
  memberKind: null,
  hasStaffAccess: false,
  hasAdminAccess: false,
};

export function resolveMemberAccess(access: MemberAccess): MemberAccess {
  const compatible = access as Partial<MemberAccess> & {
    readonly role?: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  };
  return compatible.memberKind === undefined ||
    compatible.hasStaffAccess === undefined ||
    compatible.hasAdminAccess === undefined
    ? memberAccessFromLegacyRole(compatible.role ?? null)
    : access;
}

export function memberSurfaces(access: MemberAccess): readonly MemberSurface[] {
  const authority = resolveMemberAccess(access);
  const surfaces: MemberSurface[] = [];
  if (authority.memberKind === 'STUDENT') surfaces.push('student');
  if (authority.hasStaffAccess) surfaces.push('staff');
  if (authority.hasAdminAccess) surfaces.push('admin');
  return surfaces;
}

export function memberAccessFromLegacyRole(
  role: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
): MemberAccess {
  switch (role) {
    case 'STUDENT':
      return {
        memberKind: 'STUDENT',
        hasStaffAccess: false,
        hasAdminAccess: false,
      };
    case 'STAFF':
      return {
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: false,
      };
    case 'ADMIN':
      return {
        memberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: true,
      };
    case null:
      return EMPTY_MEMBER_ACCESS;
  }
}

export function hasMemberSurface(
  access: MemberAccess,
  allowed: readonly MemberSurface[],
): boolean {
  return memberSurfaces(access).some((surface) => allowed.includes(surface));
}
