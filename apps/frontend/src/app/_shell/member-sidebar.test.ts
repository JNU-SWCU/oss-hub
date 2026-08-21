import { describe, expect, it } from 'vitest';
import { sidebarGroupsForMemberAccess } from './member-sidebar';
import type { MemberAccess } from './member-access';

function hrefs(access: MemberAccess): readonly string[] {
  return sidebarGroupsForMemberAccess('dashboard', access).flatMap((group) =>
    group.items.map((item) => item.href),
  );
}

describe('dashboard menu unions', () => {
  it.each([
    [
      'student-admin',
      { memberKind: 'STUDENT', hasStaffAccess: false, hasAdminAccess: true },
      [
        '/dashboard',
        '/my-repos',
        '/dashboard/activity',
        '/admin/access',
        '/admin/audit-log',
        '/admin/system-status',
      ],
    ],
    [
      'staff-admin',
      { memberKind: 'STAFF', hasStaffAccess: true, hasAdminAccess: true },
      [
        '/dashboard',
        '/dashboard/insights',
        '/dashboard/applicants',
        '/admin/access',
        '/admin/audit-log',
        '/admin/system-status',
      ],
    ],
    [
      'admin-only compatibility',
      { memberKind: null, hasStaffAccess: false, hasAdminAccess: true },
      ['/admin/access', '/admin/audit-log', '/admin/system-status'],
    ],
  ] satisfies readonly [string, MemberAccess, readonly string[]][])(
    'combines %s surfaces without authority implication',
    (_, access, expected) => {
      // Given: a canonical member/access tuple.
      // When: dashboard groups are composed.
      const actual = hrefs(access);
      // Then: the exact union is exposed once.
      expect(actual).toEqual(expected);
    },
  );

  it.each([
    ['pending staff', false],
    ['revoked staff', false],
  ])('keeps %s out of staff menus', (_, hasStaffAccess) => {
    // Given: STAFF membership without staff access.
    const access: MemberAccess = {
      memberKind: 'STAFF',
      hasStaffAccess,
      hasAdminAccess: false,
    };
    // When / Then: no operational menu is rendered.
    expect(hrefs(access)).toEqual([]);
  });
});
