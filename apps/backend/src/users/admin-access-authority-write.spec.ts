import { AccountStatus } from '@prisma/client';
import { accessUser } from './admin-access.service.spec-support';
import { authorityAfterLegacyTransition } from './admin-access-authority-write';
import { ADMIN_ACCESS_REQUEST_EFFECTS } from './admin-access-transition-table';
import type { AdminAccessMutationCommand } from './domain/admin-access';

function command(
  expectedRole: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
  desiredRole: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
): AdminAccessMutationCommand {
  return {
    expectedRole,
    desiredRole,
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  };
}

describe('canonical authority writes behind legacy transitions', () => {
  it('admin grant does not imply staff access', () => {
    const before = accessUser({
      role: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
    });

    const authority = authorityAfterLegacyTransition(
      before,
      command('STUDENT', 'ADMIN'),
      ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED,
    );

    expect(authority).toEqual({
      hasStaffAccess: false,
      hasAdminAccess: true,
    });
  });

  it('legacy role changes cannot clear independent canonical authority', () => {
    const before = accessUser({
      role: 'ADMIN',
      hasStaffAccess: true,
      hasAdminAccess: true,
    });

    expect(
      authorityAfterLegacyTransition(
        before,
        command('ADMIN', 'STUDENT'),
        ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED,
      ),
    ).toEqual({ hasStaffAccess: true, hasAdminAccess: true });
  });

  it('preserves independently granted staff access when rejecting a pending request', () => {
    const before = accessUser({
      role: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: false,
    });

    const authority = authorityAfterLegacyTransition(
      before,
      command('STAFF', 'STAFF'),
      ADMIN_ACCESS_REQUEST_EFFECTS.REJECTED,
    );

    expect(authority).toEqual({
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
  });

  it.each([
    [ADMIN_ACCESS_REQUEST_EFFECTS.APPROVED, true],
    [ADMIN_ACCESS_REQUEST_EFFECTS.REVOKED, false],
  ] as const)('%s changes only staff access', (effect, expectedStaffAccess) => {
    const before = accessUser({
      role: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
    });

    const authority = authorityAfterLegacyTransition(
      before,
      command('STAFF', effect === 'APPROVED' ? 'STAFF' : null),
      effect,
    );

    expect(authority.hasStaffAccess).toBe(expectedStaffAccess);
    expect(authority.hasAdminAccess).toBe(true);
  });
});
