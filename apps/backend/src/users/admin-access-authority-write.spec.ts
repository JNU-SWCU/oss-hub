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
    // Given
    const before = accessUser({
      role: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
    });

    // When
    const authority = authorityAfterLegacyTransition(
      before,
      command('STUDENT', 'ADMIN'),
      ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED,
    );

    // Then
    expect(authority).toEqual({
      hasStaffAccess: false,
      hasAdminAccess: true,
    });
  });

  it('legacy role changes cannot clear independent canonical authority', () => {
    // 서비스는 이 전이를 400으로 거절한다. 헬퍼가 호출되더라도 정본 칸을
    // 접힌 표시 역할로 비우지 않는 안전망을 고정한다.
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

  it.each([
    [ADMIN_ACCESS_REQUEST_EFFECTS.APPROVED, true],
    [ADMIN_ACCESS_REQUEST_EFFECTS.REJECTED, false],
    [ADMIN_ACCESS_REQUEST_EFFECTS.REVOKED, false],
  ] as const)('%s changes only staff access', (effect, expectedStaffAccess) => {
    // Given
    const before = accessUser({
      role: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
    });

    // When
    const authority = authorityAfterLegacyTransition(
      before,
      command('STAFF', effect === 'APPROVED' ? 'STAFF' : null),
      effect,
    );

    // Then
    expect(authority.hasStaffAccess).toBe(expectedStaffAccess);
    expect(authority.hasAdminAccess).toBe(true);
  });
});
