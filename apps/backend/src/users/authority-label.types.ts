import type { MemberKind } from '@prisma/client';

export type AuthorityLabel = 'STUDENT' | 'STAFF' | 'ADMIN';

export type AuthorityLabelSource = {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};
