import { AccountStatus } from '@prisma/client';
import { RolesErrorCode } from './domain/roles-error-code.enum';
import {
  enforceAdminAccessGuards,
  matchesExpectedAccessState,
} from './admin-access-mutation-policy';
import { accessUser, adminActor } from './admin-access.service.spec-support';
import type { AdminAccessMutationCommand } from './domain/admin-access';

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
