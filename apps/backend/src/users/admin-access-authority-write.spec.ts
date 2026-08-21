import { AccountStatus, Role } from '@prisma/client';
import { accessUser } from './admin-access.service.spec-support';
import { authorityAfterLegacyTransition } from './admin-access-authority-write';
import { ADMIN_ACCESS_REQUEST_EFFECTS } from './admin-access-transition-table';
import type { AdminAccessMutationCommand } from './domain/admin-access';

function command(
  expectedRole: Role | null,
  desiredRole: Role | null,
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
    // Given
    const before = accessUser({
      role: Role.STUDENT,
      hasStaffAccess: false,
      hasAdminAccess: false,
    });

    // When
    const authority = authorityAfterLegacyTransition(
      before,
      command(Role.STUDENT, Role.ADMIN),
      ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED,
    );

    // Then
    expect(authority).toEqual({
      hasStaffAccess: false,
      hasAdminAccess: true,
    });
  });

  it('legacy role changes cannot clear independent canonical authority', () => {
    const before = accessUser({
      role: Role.ADMIN,
      hasStaffAccess: true,
      hasAdminAccess: true,
    });

    expect(
      authorityAfterLegacyTransition(
        before,
        command(Role.ADMIN, Role.STUDENT),
        ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED,
      ),
    ).toEqual({ hasStaffAccess: true, hasAdminAccess: true });
  });

  it.each([
    [ADMIN_ACCESS_REQUEST_EFFECTS.APPROVED, true],
    [ADMIN_ACCESS_REQUEST_EFFECTS.REJECTED, false],
    [ADMIN_ACCESS_REQUEST_EFFECTS.REVOKED, false],
  ] as const)('%s changes only staff access', (effect, expectedStaffAccess) => {
    // Given
    const before = accessUser({
      role: Role.STAFF,
      hasStaffAccess: true,
      hasAdminAccess: true,
    });

    // When
    const authority = authorityAfterLegacyTransition(
      before,
      command(Role.STAFF, effect === 'APPROVED' ? Role.STAFF : null),
      effect,
    );

    // Then
    expect(authority.hasStaffAccess).toBe(expectedStaffAccess);
    expect(authority.hasAdminAccess).toBe(true);
  });
});
