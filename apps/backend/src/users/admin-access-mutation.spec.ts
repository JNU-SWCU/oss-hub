import { AccountStatus } from '@prisma/client';
import { accessUser, adminActor } from './admin-access.service.spec-support';
import { RolesErrorCode } from './roles-error-code.error';
import {
  authorityAfterLegacyTransition,
  enforceAdminAccessGuards,
  matchesExpectedAccessState,
  ADMIN_ACCESS_REQUEST_EFFECTS,
  type AdminAccessMutationCommand,
} from './admin-access-mutation.service';

describe('admin-access-authority-write', () => {
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
    ] as const)(
      '%s changes only staff access',
      (effect, expectedStaffAccess) => {
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
      },
    );
  });
});

const ALLOW_ALL = {
  requiresCompleteProfile: false,
  requiresSelfDeactivationGuard: false,
  requiresLastActiveAdminGuard: false,
} as const;

function promoteToAdmin(): AdminAccessMutationCommand {
  return {
    expectedRole: 'STAFF',
    desiredRole: 'ADMIN',
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  };
}

function freshnessCommand(
  overrides: Partial<AdminAccessMutationCommand> = {},
): AdminAccessMutationCommand {
  return {
    expectedRole: 'ADMIN',
    desiredRole: 'ADMIN',
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
    ...overrides,
  };
}

describe('matchesExpectedAccessState — 정본 신선도', () => {
  const adminOnly = accessUser({
    role: 'ADMIN',
    hasStaffAccess: false,
    hasAdminAccess: true,
  });
  const staffAndAdmin = accessUser({
    role: 'ADMIN',
    hasStaffAccess: true,
    hasAdminAccess: true,
  });

  it('접힌 expectedRole만으로는 admin-only와 staff+admin을 구분하지 못한다', () => {
    const folded = freshnessCommand({ expectedRole: 'ADMIN' });

    expect(matchesExpectedAccessState(adminOnly, folded)).toBe(true);
    expect(matchesExpectedAccessState(staffAndAdmin, folded)).toBe(true);
  });

  it('정본 boolean 기대값은 admin-only와 staff+admin을 구분한다', () => {
    const sawAdminOnly = freshnessCommand({
      expectedRole: 'ADMIN',
      expectedHasStaffAccess: false,
      expectedHasAdminAccess: true,
    });

    expect(matchesExpectedAccessState(adminOnly, sawAdminOnly)).toBe(true);
    expect(matchesExpectedAccessState(staffAndAdmin, sawAdminOnly)).toBe(false);
  });
});

describe('enforceAdminAccessGuards — 자기 승격 백스톱', () => {
  it('actor와 대상이 같은 행이고 ADMIN을 부여하는 전이면 ROL_004로 막는다', () => {
    const actor = adminActor();
    const before = accessUser({ id: actor.id, role: 'STAFF' });

    let thrown: unknown;
    try {
      enforceAdminAccessGuards(actor, before, promoteToAdmin(), ALLOW_ALL, 2);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
    });
  });

  it('대상이 다른 행이면 ADMIN 부여를 막지 않는다', () => {
    const actor = adminActor();
    const before = accessUser({ id: 'someone-else', role: 'STAFF' });

    expect(() =>
      enforceAdminAccessGuards(actor, before, promoteToAdmin(), ALLOW_ALL, 2),
    ).not.toThrow();
  });

  it('같은 행이어도 이미 ADMIN이면 막지 않는다 — 이게 실제 저장소가 만드는 상태다', () => {
    const actor = adminActor();
    const before = accessUser({ id: actor.id, role: 'ADMIN' });

    expect(() =>
      enforceAdminAccessGuards(actor, before, promoteToAdmin(), ALLOW_ALL, 2),
    ).not.toThrow();
  });
});
