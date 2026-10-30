import { MemberKind } from '@prisma/client';

export type AuthorityLabel = 'STUDENT' | 'STAFF' | 'ADMIN';

export type AuthorityLabelSource = {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export function authorityLabel(
  source: AuthorityLabelSource,
): AuthorityLabel | null {
  if (source.hasAdminAccess) {
    return 'ADMIN';
  }
  if (source.hasStaffAccess) {
    return 'STAFF';
  }
  return source.memberKind === MemberKind.STUDENT ? 'STUDENT' : null;
}
