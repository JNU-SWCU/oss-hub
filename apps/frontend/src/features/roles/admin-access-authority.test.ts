import { describe, expect, it } from 'vitest';
import { adminAccessAuthority } from './admin-access-authority';

describe('admin access authority projection', () => {
  it.each([
    [
      'student-admin',
      {
        role: 'ADMIN',
        memberKind: 'STUDENT',
        hasStaffAccess: false,
        hasAdminAccess: true,
      },
      {
        memberKind: 'STUDENT',
        hasStaffAccess: false,
        hasAdminAccess: true,
      },
    ],
    [
      'staff-admin',
      {
        role: 'ADMIN',
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: true,
      },
      {
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: true,
      },
    ],
    [
      'legacy admin-only',
      { role: 'ADMIN' },
      {
        memberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: true,
      },
    ],
  ] as const)(
    'keeps %s staff/admin facts independent',
    (_, source, expected) => {
      // Given: a canonical or legacy-compatible admin detail projection.
      // When: the control state is resolved.
      const actual = adminAccessAuthority(source);
      // Then: admin never manufactures staff access.
      expect(actual).toEqual(expected);
    },
  );
});
