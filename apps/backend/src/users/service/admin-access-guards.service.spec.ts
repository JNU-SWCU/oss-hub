import { AccountStatus } from '@prisma/client';
import { AuthErrorCode } from '../../auth/domain/auth-error-code.enum';
import { RolesErrorCode } from '../domain/roles-error-code.enum';
import { UsersErrorCode } from '../domain/users-error-code.enum';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from '../domain/admin-access';
import { AdminAccessService } from './admin-access.service';
import {
  ADMIN_GITHUB_ID,
  InMemoryAdminAccessRepository,
  PENDING_REQUEST,
  accessUser,
  adminActor,
  auditLogHarness,
} from './admin-access.service.spec-support';

describe('AdminAccessService mutation guards', () => {
  it('locks active admins before the target and preserves the final admin', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.activeAdminCount = 1;
    repository.target = accessUser({
      id: 'other-admin',
      role: 'ADMIN',
      hasAdminAccess: true,
    });
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'other-admin', {
        expectedRole: 'ADMIN',
        desiredRole: 'ADMIN',
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.DEACTIVATED,
        expectedPendingRequest: null,
      }),
    ).rejects.toMatchObject({
      errorCode: {
        code: RolesErrorCode.LAST_ACTIVE_ADMIN_REQUIRED,
        status: 409,
      },
    });

    expect(repository.operations).toEqual([
      'find-actor',
      'lock-active-admins',
      'find-actor',
      'find-user-for-update',
    ]);
    expect(repository.userUpdates).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects an administrator deactivating their own account', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.actor = adminActor();
    repository.target = accessUser({
      id: 'admin',
      githubId: ADMIN_GITHUB_ID,
      role: 'ADMIN',
      hasAdminAccess: true,
    });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'admin', {
        expectedRole: 'ADMIN',
        desiredRole: 'ADMIN',
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.DEACTIVATED,
        expectedPendingRequest: null,
      }),
    ).rejects.toMatchObject({
      errorCode: {
        code: RolesErrorCode.SELF_DEACTIVATION_FORBIDDEN,
        status: 409,
      },
    });
    expect(repository.userUpdates).toEqual([]);
  });

  it.each([
    [
      'STAFF로 강등된',
      adminActor({ role: 'STAFF', hasAdminAccess: false }),
      RolesErrorCode.ADMIN_ONLY,
      403,
    ],
    [
      '비활성화된',
      adminActor({ accountStatus: AccountStatus.DEACTIVATED }),
      AuthErrorCode.UNAUTHENTICATED,
      401,
    ],
    ['사라진', null, AuthErrorCode.UNAUTHENTICATED, 401],
  ] as const)(
    '%s actor는 잠금 뒤 재검증에서 거부되고 아무것도 쓰지 않는다',
    async (_label, actor, code, status) => {
      const repository = new InMemoryAdminAccessRepository();
      repository.actorAfterLock = actor;
      const audit = auditLogHarness();
      const service = new AdminAccessService(repository, audit.service);

      await expect(
        service.patchAccess(ADMIN_GITHUB_ID, 'target', {
          expectedRole: 'STUDENT',
          desiredRole: 'STAFF',
          expectedAccountStatus: AccountStatus.ACTIVE,
          desiredAccountStatus: AccountStatus.ACTIVE,
          expectedPendingRequest: null,
        }),
      ).rejects.toMatchObject({ errorCode: { code, status } });

      expect(repository.operations).toEqual([
        'find-actor',
        'lock-active-admins',
        'find-actor',
      ]);
      expect(repository.userUpdates).toEqual([]);
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('다른 사람을 ADMIN으로 올리는 것은 그대로 허용된다', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.actor = adminActor();
    repository.target = accessUser({ role: 'STAFF' });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    const result = await service.patchAccess(ADMIN_GITHUB_ID, 'target', {
      expectedRole: 'STAFF',
      desiredRole: 'ADMIN',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });

    expect(result.role).toBe('ADMIN');
  });

  it('requires a complete profile before approving a pending staff request', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.target = accessUser({
      role: null,
      isProfileComplete: false,
      pendingRequest: PENDING_REQUEST,
    });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'target', {
        expectedRole: null,
        desiredRole: 'STAFF',
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: {
          id: PENDING_REQUEST.id,
          status: PENDING_REQUEST.status,
        },
        requestDecision: {
          decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE,
        },
      }),
    ).rejects.toMatchObject({
      errorCode: { code: UsersErrorCode.PROFILE_INCOMPLETE, status: 409 },
    });
    expect(repository.userUpdates).toEqual([]);
  });
});
