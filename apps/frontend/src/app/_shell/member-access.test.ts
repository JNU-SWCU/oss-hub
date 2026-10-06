import { describe, expect, it } from 'vitest';
import {
  memberSurfaces,
  type MemberAccess,
  type MemberSurface,
} from './member-access';

const MATRIX: readonly [string, MemberAccess, readonly MemberSurface[]][] = [
  [
    'STUDENT',
    { memberKind: 'STUDENT', hasStaffAccess: false, hasAdminAccess: false },
    ['student'],
  ],
  [
    'STAFF pending',
    { memberKind: 'STAFF', hasStaffAccess: false, hasAdminAccess: false },
    [],
  ],
  [
    'STAFF approved',
    { memberKind: 'STAFF', hasStaffAccess: true, hasAdminAccess: false },
    ['staff'],
  ],
  [
    'STAFF revoked',
    { memberKind: 'STAFF', hasStaffAccess: false, hasAdminAccess: false },
    [],
  ],
  [
    'student-admin',
    { memberKind: 'STUDENT', hasStaffAccess: false, hasAdminAccess: true },
    ['student', 'admin'],
  ],
  [
    'staff-admin',
    { memberKind: 'STAFF', hasStaffAccess: true, hasAdminAccess: true },
    ['staff', 'admin'],
  ],
  [
    'admin-only compatibility',
    { memberKind: null, hasStaffAccess: false, hasAdminAccess: true },
    ['admin'],
  ],
  [
    'deactivated',
    { memberKind: null, hasStaffAccess: false, hasAdminAccess: false },
    [],
  ],
  [
    'unassigned',
    { memberKind: null, hasStaffAccess: false, hasAdminAccess: false },
    [],
  ],
];

describe('member access surface matrix', () => {
  it.each(MATRIX)(
    'returns independent surfaces for %s',
    (_, access, expected) => {
      const actual = memberSurfaces(access);

      expect(actual).toEqual(expected);
    },
  );

  it('does not infer staff access from admin access', () => {
    const access: MemberAccess = {
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: true,
    };

    expect(memberSurfaces(access)).toEqual(['admin']);
  });
});
