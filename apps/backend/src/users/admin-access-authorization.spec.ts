import { AccountStatus, Role } from '@prisma/client';
import { AuthErrorCode } from '../auth/auth-error-code.enum';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import {
  ADMIN_ACCESS_REQUEST_DECISIONS,
  type AdminAccessMutationCommand,
} from './domain/admin-access';
import {
  assertAccessMutationAllowed,
  isAdminActor,
  requireActiveAdmin,
  requireActiveStaffOrAdmin,
} from './admin-access-authorization';
import { adminActor } from './admin-access.service.spec-support';

const APPROVE_COMMAND: AdminAccessMutationCommand = {
  expectedRole: null,
  desiredRole: Role.STAFF,
  expectedAccountStatus: AccountStatus.ACTIVE,
  desiredAccountStatus: AccountStatus.ACTIVE,
  expectedPendingRequest: { id: 'request-pending', status: 'PENDING' },
  requestDecision: { decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE },
};

const SET_ROLE_COMMAND: AdminAccessMutationCommand = {
  expectedRole: Role.STUDENT,
  desiredRole: Role.STAFF,
  expectedAccountStatus: AccountStatus.ACTIVE,
  desiredAccountStatus: AccountStatus.ACTIVE,
  expectedPendingRequest: null,
};

function expectThrownCode(run: () => void, code: string, status: number): void {
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ errorCode: { code, status } });
    return;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

describe('requireActiveStaffOrAdmin', () => {
  it('allows an active STAFF actor', () => {
    const actor = adminActor({
      id: 'staff',
      role: Role.STAFF,
      hasAdminAccess: false,
    });
    expect(requireActiveStaffOrAdmin(actor)).toBe(actor);
  });

  it('allows an active ADMIN actor', () => {
    const actor = adminActor();
    expect(requireActiveStaffOrAdmin(actor)).toBe(actor);
  });

  it.each([
    ['missing', null, AuthErrorCode.UNAUTHENTICATED, 401],
    [
      'deactivated',
      adminActor({ accountStatus: AccountStatus.DEACTIVATED }),
      AuthErrorCode.UNAUTHENTICATED,
      401,
    ],
    [
      'student',
      adminActor({
        role: Role.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      RolesErrorCode.ADMIN_ONLY,
      403,
    ],
  ] as const)('rejects a %s actor', (_, actor, code, status) => {
    expectThrownCode(() => requireActiveStaffOrAdmin(actor), code, status);
  });
});

describe('requireActiveAdmin', () => {
  it('still rejects STAFF', () => {
    expectThrownCode(
      () =>
        requireActiveAdmin(
          adminActor({ role: Role.STAFF, hasAdminAccess: false }),
        ),
      RolesErrorCode.ADMIN_ONLY,
      403,
    );
  });
});

/**
 * canonical `hasStaffAccess`·`hasAdminAccess`가 legacy `role`과 **엇갈릴 때** 어느 쪽을
 * 따르는가 — 이 모듈이 canonical로 옮겨졌다는 주장은 오직 여기서만 증명된다.
 * 둘이 같은 행만 쓰면 legacy 비교로 되돌려도 전부 초록으로 남아 이전이 무효화된다.
 *
 * 이 불일치는 상상이 아니다 — 독립 권한 부여(`independent-authority-transition.ts`)는
 * `role`을 그대로 둔 채 canonical 칸만 바꿀 수 있고, backfill 이전 행은 그 반대다.
 */
describe('canonical access fields outrank legacy role', () => {
  it('grants admin authorization on hasAdminAccess even when the role says STAFF', () => {
    const actor = adminActor({ role: Role.STAFF, hasAdminAccess: true });

    expect(requireActiveAdmin(actor)).toBe(actor);
    expect(isAdminActor(actor)).toBe(true);
  });

  it('denies admin authorization without hasAdminAccess even when the role says ADMIN', () => {
    const actor = adminActor({ role: Role.ADMIN, hasAdminAccess: false });

    expectThrownCode(
      () => requireActiveAdmin(actor),
      RolesErrorCode.ADMIN_ONLY,
      403,
    );
    expect(isAdminActor(actor)).toBe(false);
  });

  it('grants staff authorization on hasStaffAccess even when the role says STUDENT', () => {
    const actor = adminActor({
      role: Role.STUDENT,
      hasStaffAccess: true,
      hasAdminAccess: false,
    });

    expect(requireActiveStaffOrAdmin(actor)).toBe(actor);
  });

  it('denies staff authorization without either access flag even when the role says ADMIN', () => {
    expectThrownCode(
      () =>
        requireActiveStaffOrAdmin(
          adminActor({
            role: Role.ADMIN,
            hasStaffAccess: false,
            hasAdminAccess: false,
          }),
        ),
      RolesErrorCode.ADMIN_ONLY,
      403,
    );
  });

  it('routes STAFF-only mutation limits by hasAdminAccess, not by the role column', () => {
    // role은 ADMIN이지만 canonical로는 관리자가 아니므로 STAFF 제약을 받는다.
    expectThrownCode(
      () =>
        assertAccessMutationAllowed(
          adminActor({
            id: 'demoted',
            role: Role.ADMIN,
            hasAdminAccess: false,
          }),
          'target',
          SET_ROLE_COMMAND,
        ),
      RolesErrorCode.ADMIN_ONLY,
      403,
    );
  });
});

describe('assertAccessMutationAllowed', () => {
  it('allows STAFF to approve another user', () => {
    expect(() =>
      assertAccessMutationAllowed(
        adminActor({ id: 'staff', role: Role.STAFF, hasAdminAccess: false }),
        'target',
        APPROVE_COMMAND,
      ),
    ).not.toThrow();
  });

  it('rejects STAFF SET_ROLE with ROL_004', () => {
    expectThrownCode(
      () =>
        assertAccessMutationAllowed(
          adminActor({ id: 'staff', role: Role.STAFF, hasAdminAccess: false }),
          'target',
          SET_ROLE_COMMAND,
        ),
      RolesErrorCode.ADMIN_ONLY,
      403,
    );
  });

  it('rejects actor === target even for APPROVE', () => {
    expectThrownCode(
      () =>
        assertAccessMutationAllowed(
          adminActor({ id: 'target', role: Role.STAFF, hasAdminAccess: false }),
          'target',
          APPROVE_COMMAND,
        ),
      RolesErrorCode.SELF_ACCESS_MUTATION_FORBIDDEN,
      409,
    );
  });

  it('does not intercept self-deactivation or self-demotion', () => {
    expect(() =>
      assertAccessMutationAllowed(adminActor({ id: 'admin' }), 'admin', {
        expectedRole: Role.ADMIN,
        desiredRole: Role.ADMIN,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.DEACTIVATED,
        expectedPendingRequest: null,
      }),
    ).not.toThrow();
    expect(() =>
      assertAccessMutationAllowed(adminActor({ id: 'admin' }), 'admin', {
        expectedRole: Role.ADMIN,
        desiredRole: Role.STAFF,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      }),
    ).not.toThrow();
  });

  it('allows ADMIN SET_ROLE on another user', () => {
    expect(() =>
      assertAccessMutationAllowed(adminActor(), 'target', SET_ROLE_COMMAND),
    ).not.toThrow();
  });

  it('isAdminActor is true only for ADMIN', () => {
    expect(isAdminActor(adminActor())).toBe(true);
    expect(
      isAdminActor(adminActor({ role: Role.STAFF, hasAdminAccess: false })),
    ).toBe(false);
  });
});
