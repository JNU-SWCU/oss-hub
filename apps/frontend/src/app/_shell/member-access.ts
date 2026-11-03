type MemberKind = 'STUDENT' | 'STAFF';
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
  if (hasStaffAudience(access)) surfaces.push('staff');
  if (access.hasAdminAccess) surfaces.push('admin');
  return surfaces;
}

export function hasStaffAudience(
  access: Pick<MemberAccess, 'memberKind' | 'hasStaffAccess'>,
): boolean {
  return access.memberKind === 'STAFF' && access.hasStaffAccess;
}

export function hasMemberSurface(
  access: MemberAccess,
  allowed: readonly MemberSurface[],
): boolean {
  return memberSurfaces(access).some((surface) => allowed.includes(surface));
}
