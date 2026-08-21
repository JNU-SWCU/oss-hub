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

export function memberSurfaces(access: MemberAccess): readonly MemberSurface[] {
  const surfaces: MemberSurface[] = [];
  if (access.memberKind === 'STUDENT') surfaces.push('student');
  if (access.hasStaffAccess) surfaces.push('staff');
  if (access.hasAdminAccess) surfaces.push('admin');
  return surfaces;
}

export function hasMemberSurface(
  access: MemberAccess,
  allowed: readonly MemberSurface[],
): boolean {
  return memberSurfaces(access).some((surface) => allowed.includes(surface));
}
