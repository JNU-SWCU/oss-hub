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
    const actor = adminActor({ id: 'staff', role: Role.STAFF });
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
      adminActor({ role: Role.STUDENT }),
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
      () => requireActiveAdmin(adminActor({ role: Role.STAFF })),
      RolesErrorCode.ADMIN_ONLY,
      403,
    );
  });
});

describe('assertAccessMutationAllowed', () => {
  it('allows STAFF to approve another user', () => {
    expect(() =>
      assertAccessMutationAllowed(
        adminActor({ id: 'staff', role: Role.STAFF }),
        'target',
        APPROVE_COMMAND,
      ),
    ).not.toThrow();
  });

  it('rejects STAFF SET_ROLE with ROL_004', () => {
    expectThrownCode(
      () =>
        assertAccessMutationAllowed(
          adminActor({ id: 'staff', role: Role.STAFF }),
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
          adminActor({ id: 'target', role: Role.STAFF }),
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
    expect(isAdminActor(adminActor({ role: Role.STAFF }))).toBe(false);
  });
});
