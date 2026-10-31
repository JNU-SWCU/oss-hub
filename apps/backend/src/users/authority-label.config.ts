import type {
  AuthorityLabel,
  AuthorityLabelSource,
} from './authority-label.types';
import { MemberKind } from '@prisma/client';

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
