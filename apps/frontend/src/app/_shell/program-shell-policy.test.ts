import { describe, expect, it } from 'vitest';
import { programScopeViewerRole } from './program-shell-policy';

describe('programScopeViewerRole participation resolution', () => {
  describe.each([
    [
      { memberKind: 'STUDENT', hasStaffAccess: true, hasAdminAccess: false },
      'STAFF',
    ],
    [
      { memberKind: 'STUDENT', hasStaffAccess: false, hasAdminAccess: true },
      'ADMIN',
    ],
    [
      { memberKind: 'STUDENT', hasStaffAccess: true, hasAdminAccess: true },
      'ADMIN',
    ],
  ] as const)('%s', (authority, role) => {
    it.each([undefined, false])(
      'keeps the operations role until participation is confirmed: %s',
      (participant) => {
        expect(programScopeViewerRole(true, authority, participant)).toBe(role);
      },
    );
  });

  it('defaults to the student view only after participation is confirmed', () => {
    const authority = {
      memberKind: 'STUDENT',
      hasStaffAccess: true,
      hasAdminAccess: true,
    } as const;
    expect(programScopeViewerRole(true, authority, true)).toBe('STUDENT');
    expect(programScopeViewerRole(true, authority, true, true)).toBe('ADMIN');
  });

  it.each([undefined, false, true])(
    'preserves ordinary student access: %s',
    (participant) => {
      expect(
        programScopeViewerRole(
          true,
          {
            memberKind: 'STUDENT',
            hasStaffAccess: false,
            hasAdminAccess: false,
          },
          participant,
        ),
      ).toBe('STUDENT');
    },
  );
});
