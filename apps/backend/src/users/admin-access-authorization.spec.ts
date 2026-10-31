import { AccountStatus } from '@prisma/client';
import { AuthErrorCode } from '../auth/auth-error-code.error';
import { RolesErrorCode } from './roles-error-code.error';
import { adminActor } from './admin-access.service.spec-support';
import {
  type AdminAccessMutationCommand,
  AdminAccessMutationService,
} from './admin-access-mutation.service';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './admin-access-query.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';

const adminAccessMutationService = new AdminAccessMutationService(
  new AuditLogMetadataService(),
  new UserProfileService(),
);

const APPROVE_COMMAND: AdminAccessMutationCommand = {
  expectedRole: null,
  desiredRole: 'STAFF',
  expectedAccountStatus: AccountStatus.ACTIVE,
  desiredAccountStatus: AccountStatus.ACTIVE,
  expectedPendingRequest: { id: 'request-pending', status: 'PENDING' },
  requestDecision: { decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE },
};

const SET_ROLE_COMMAND: AdminAccessMutationCommand = {
  expectedRole: 'STUDENT',
  desiredRole: 'STAFF',
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
      hasAdminAccess: false,
    });
    expect(adminAccessMutationService.requireActiveStaffOrAdmin(actor)).toBe(
      actor,
    );
  });

  it('allows an active ADMIN actor', () => {
    const actor = adminActor();
    expect(adminAccessMutationService.requireActiveStaffOrAdmin(actor)).toBe(
      actor,
    );
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
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
      RolesErrorCode.ADMIN_ONLY,
      403,
    ],
  ] as const)('rejects a %s actor', (_, actor, code, status) => {
    expectThrownCode(
      () => adminAccessMutationService.requireActiveStaffOrAdmin(actor),
      code,
      status,
    );
  });
});

describe('requireActiveAdmin', () => {
  it('still rejects STAFF', () => {
    expectThrownCode(
      () =>
        adminAccessMutationService.requireActiveAdmin(
          adminActor({ hasAdminAccess: false }),
        ),
      RolesErrorCode.ADMIN_ONLY,
      403,
    );
  });
});

describe('canonical access fields outrank legacy role', () => {
  it('grants admin authorization on hasAdminAccess even when the role says STAFF', () => {
    const actor = adminActor({ hasAdminAccess: true });

    expect(adminAccessMutationService.requireActiveAdmin(actor)).toBe(actor);
    expect(adminAccessMutationService.isAdminActor(actor)).toBe(true);
  });

  it('denies admin authorization without hasAdminAccess even when the role says ADMIN', () => {
    const actor = adminActor({ hasAdminAccess: false });

    expectThrownCode(
      () => adminAccessMutationService.requireActiveAdmin(actor),
      RolesErrorCode.ADMIN_ONLY,
      403,
    );
    expect(adminAccessMutationService.isAdminActor(actor)).toBe(false);
  });

  it('grants staff authorization on hasStaffAccess even when the role says STUDENT', () => {
    const actor = adminActor({
      hasStaffAccess: true,
      hasAdminAccess: false,
    });

    expect(adminAccessMutationService.requireActiveStaffOrAdmin(actor)).toBe(
      actor,
    );
  });

  it('denies staff authorization without either access flag even when the role says ADMIN', () => {
    expectThrownCode(
      () =>
        adminAccessMutationService.requireActiveStaffOrAdmin(
          adminActor({
            hasStaffAccess: false,
            hasAdminAccess: false,
          }),
        ),
      RolesErrorCode.ADMIN_ONLY,
      403,
    );
  });

  it('routes STAFF-only mutation limits by hasAdminAccess, not by the role column', () => {
    expectThrownCode(
      () =>
        adminAccessMutationService.assertAccessMutationAllowed(
          adminActor({
            id: 'demoted',
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
      adminAccessMutationService.assertAccessMutationAllowed(
        adminActor({ id: 'staff', hasAdminAccess: false }),
        'target',
        APPROVE_COMMAND,
      ),
    ).not.toThrow();
  });

  it('rejects STAFF SET_ROLE with ROL_004', () => {
    expectThrownCode(
      () =>
        adminAccessMutationService.assertAccessMutationAllowed(
          adminActor({ id: 'staff', hasAdminAccess: false }),
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
        adminAccessMutationService.assertAccessMutationAllowed(
          adminActor({ id: 'target', hasAdminAccess: false }),
          'target',
          APPROVE_COMMAND,
        ),
      RolesErrorCode.SELF_ACCESS_MUTATION_FORBIDDEN,
      409,
    );
  });

  it('does not intercept self-deactivation or self-demotion', () => {
    expect(() =>
      adminAccessMutationService.assertAccessMutationAllowed(
        adminActor({ id: 'admin' }),
        'admin',
        {
          expectedRole: 'ADMIN',
          desiredRole: 'ADMIN',
          expectedAccountStatus: AccountStatus.ACTIVE,
          desiredAccountStatus: AccountStatus.DEACTIVATED,
          expectedPendingRequest: null,
        },
      ),
    ).not.toThrow();
    expect(() =>
      adminAccessMutationService.assertAccessMutationAllowed(
        adminActor({ id: 'admin' }),
        'admin',
        {
          expectedRole: 'ADMIN',
          desiredRole: 'STAFF',
          expectedAccountStatus: AccountStatus.ACTIVE,
          desiredAccountStatus: AccountStatus.ACTIVE,
          expectedPendingRequest: null,
        },
      ),
    ).not.toThrow();
  });

  it('allows ADMIN SET_ROLE on another user', () => {
    expect(() =>
      adminAccessMutationService.assertAccessMutationAllowed(
        adminActor(),
        'target',
        SET_ROLE_COMMAND,
      ),
    ).not.toThrow();
  });

  describe('STAFF가 결정에 다른 조작을 얹어 보내는 경우 (#1082)', () => {
    const staff = () => adminActor({ id: 'staff', hasAdminAccess: false });

    it('반려에 ADMIN 역할 부여를 얹으면 거절한다', () => {
      expectThrownCode(
        () =>
          adminAccessMutationService.assertAccessMutationAllowed(
            staff(),
            'target',
            {
              expectedRole: null,
              desiredRole: 'ADMIN',
              expectedAccountStatus: AccountStatus.ACTIVE,
              desiredAccountStatus: AccountStatus.ACTIVE,
              expectedPendingRequest: {
                id: 'request-pending',
                status: 'PENDING',
              },
              requestDecision: {
                decision: ADMIN_ACCESS_REQUEST_DECISIONS.REJECT,
                reason: '사유',
              },
            },
          ),
        RolesErrorCode.ADMIN_ONLY,
        403,
      );
    });

    it('승인에 ADMIN 역할 부여를 얹으면 거절한다', () => {
      expectThrownCode(
        () =>
          adminAccessMutationService.assertAccessMutationAllowed(
            staff(),
            'target',
            {
              ...APPROVE_COMMAND,
              desiredRole: 'ADMIN',
            },
          ),
        RolesErrorCode.ADMIN_ONLY,
        403,
      );
    });

    it('반려에 계정 상태 변경을 얹으면 거절한다', () => {
      expectThrownCode(
        () =>
          adminAccessMutationService.assertAccessMutationAllowed(
            staff(),
            'target',
            {
              expectedRole: null,
              desiredRole: null,
              expectedAccountStatus: AccountStatus.ACTIVE,
              desiredAccountStatus: AccountStatus.DEACTIVATED,
              expectedPendingRequest: {
                id: 'request-pending',
                status: 'PENDING',
              },
              requestDecision: {
                decision: ADMIN_ACCESS_REQUEST_DECISIONS.REJECT,
                reason: '사유',
              },
            },
          ),
        RolesErrorCode.ADMIN_ONLY,
        403,
      );
    });

    it('순수한 승인은 그대로 통과한다', () => {
      expect(() =>
        adminAccessMutationService.assertAccessMutationAllowed(
          staff(),
          'target',
          APPROVE_COMMAND,
        ),
      ).not.toThrow();
    });

    it('순수한 반려는 그대로 통과한다', () => {
      expect(() =>
        adminAccessMutationService.assertAccessMutationAllowed(
          staff(),
          'target',
          {
            expectedRole: null,
            desiredRole: null,
            expectedAccountStatus: AccountStatus.ACTIVE,
            desiredAccountStatus: AccountStatus.ACTIVE,
            expectedPendingRequest: {
              id: 'request-pending',
              status: 'PENDING',
            },
            requestDecision: {
              decision: ADMIN_ACCESS_REQUEST_DECISIONS.REJECT,
              reason: '사유',
            },
          },
        ),
      ).not.toThrow();
    });

    it('관리자는 결정과 역할 변경을 함께 보낼 수 있다', () => {
      expect(() =>
        adminAccessMutationService.assertAccessMutationAllowed(
          adminActor(),
          'target',
          {
            ...APPROVE_COMMAND,
            desiredRole: 'ADMIN',
          },
        ),
      ).not.toThrow();
    });
  });

  it('isAdminActor is true only for ADMIN', () => {
    expect(adminAccessMutationService.isAdminActor(adminActor())).toBe(true);
    expect(
      adminAccessMutationService.isAdminActor(
        adminActor({ hasAdminAccess: false }),
      ),
    ).toBe(false);
  });
});
