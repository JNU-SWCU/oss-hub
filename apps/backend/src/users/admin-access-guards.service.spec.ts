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

  it('actor가 자기 자신에게 ADMIN을 부여하는 요청은 ROL_004/403으로 거부된다', async () => {
    // Given — 경합으로 STAFF가 된 관리자가 자기 권한을 되살리려는 모양이다(#687).
    const repository = new InMemoryAdminAccessRepository();
    repository.actor = adminActor();
    repository.target = accessUser({
      id: 'admin',
      githubId: ADMIN_GITHUB_ID,
      role: Role.STAFF,
    });
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When / Then
    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'admin', {
        expectedRole: Role.STAFF,
        desiredRole: Role.ADMIN,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: null,
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
    });
    expect(repository.userUpdates).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('다른 사람을 ADMIN으로 올리는 것은 그대로 허용된다', async () => {
    // Given — 자기 승격 가드가 관리자 임명 자체를 막아 버리면 운영이 멈춘다.
    const repository = new InMemoryAdminAccessRepository();
    repository.actor = adminActor();
    repository.target = accessUser({ role: Role.STAFF });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    // When
    const result = await service.patchAccess(ADMIN_GITHUB_ID, 'target', {
      expectedRole: Role.STAFF,
      desiredRole: Role.ADMIN,
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });

    // Then
    expect(result.role).toBe(Role.ADMIN);
  });

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
