import { AccountStatus, Role } from '@prisma/client';
import { AuthErrorCode } from '../auth/auth-error-code.enum';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { UsersErrorCode } from './users-error-code.enum';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './domain/admin-access';
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
    // Given
    const repository = new InMemoryAdminAccessRepository();
    repository.activeAdminCount = 1;
    repository.target = accessUser({ role: Role.ADMIN });
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When / Then
    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'target', {
        expectedRole: Role.ADMIN,
        desiredRole: Role.STAFF,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      }),
    ).rejects.toMatchObject({
      errorCode: {
        code: RolesErrorCode.LAST_ACTIVE_ADMIN_REQUIRED,
        status: 409,
      },
    });
    // actor 조회가 잠금 **뒤에** 있다 — 이 순서가 뒤집히면 잠기지 않은 낡은 actor로
    // 판정하게 되고, 그게 #687의 TOCTOU 창이다.
    expect(repository.operations).toEqual([
      'lock-active-admins',
      'find-actor',
      'find-user-for-update',
    ]);
    expect(repository.userUpdates).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects an administrator deactivating their own account', async () => {
    // Given
    const repository = new InMemoryAdminAccessRepository();
    repository.actor = adminActor();
    repository.target = accessUser({
      id: 'admin',
      githubId: ADMIN_GITHUB_ID,
      role: Role.ADMIN,
    });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    // When / Then
    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'admin', {
        expectedRole: Role.ADMIN,
        desiredRole: Role.ADMIN,
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
      adminActor({ role: Role.STAFF }),
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
      // Given — 잠금을 잡은 뒤 읽은 actor가 더 이상 활성 ADMIN이 아닌 상태다(#687).
      const repository = new InMemoryAdminAccessRepository();
      repository.actor = actor;
      const audit = auditLogHarness();
      const service = new AdminAccessService(repository, audit.service);

      // When / Then
      await expect(
        service.patchAccess(ADMIN_GITHUB_ID, 'target', {
          expectedRole: Role.STUDENT,
          desiredRole: Role.STAFF,
          expectedAccountStatus: AccountStatus.ACTIVE,
          desiredAccountStatus: AccountStatus.ACTIVE,
          expectedPendingRequest: null,
        }),
      ).rejects.toMatchObject({ errorCode: { code, status } });
      // 대상 행을 읽기도 전에 멈춘다 — 거부는 잠금 직후 재검증에서 난다.
      expect(repository.operations).toEqual([
        'lock-active-admins',
        'find-actor',
      ]);
      expect(repository.userUpdates).toEqual([]);
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('requires a complete profile before approving a pending staff request', async () => {
    // Given
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

    // When / Then
    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'target', {
        expectedRole: null,
        desiredRole: Role.STAFF,
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
