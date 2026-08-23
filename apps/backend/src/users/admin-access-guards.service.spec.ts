import { AccountStatus } from '@prisma/client';
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
    // Given — 레거시 표시 강등은 400으로 거절되므로, 마지막 관리자 가드는
    // 실제로 활성 관리자를 없앨 수 있는 비활성화 경로에서 증명한다.
    const repository = new InMemoryAdminAccessRepository();
    repository.activeAdminCount = 1;
    repository.target = accessUser({
      id: 'other-admin',
      role: 'ADMIN',
      hasAdminAccess: true,
    });
    const audit = auditLogHarness();
    const service = new AdminAccessService(repository, audit.service);

    // When / Then
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
    // actor 조회가 잠금 **뒤에** 있다 — 이 순서가 뒤집히면 잠기지 않은 낡은 actor로
    // 판정하게 되고, 그게 #687의 TOCTOU 창이다.
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
    // Given
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

    // When / Then
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
      // Given — 잠금 이전 읽기에서는 멀쩡한 활성 ADMIN이었다가, 잠금을 잡은 뒤 읽으면
      // 더 이상 활성 ADMIN이 아닌 상태다(#687). 잠금 전부터 무효한 actor는 잠금 이전
      // 빠른 거부에 걸려 이 재검증 경로를 지나가지 않으므로 여기서 쓸 fixture가 아니다.
      const repository = new InMemoryAdminAccessRepository();
      repository.actorAfterLock = actor;
      const audit = auditLogHarness();
      const service = new AdminAccessService(repository, audit.service);

      // When / Then
      await expect(
        service.patchAccess(ADMIN_GITHUB_ID, 'target', {
          expectedRole: 'STUDENT',
          desiredRole: 'STAFF',
          expectedAccountStatus: AccountStatus.ACTIVE,
          desiredAccountStatus: AccountStatus.ACTIVE,
          expectedPendingRequest: null,
        }),
      ).rejects.toMatchObject({ errorCode: { code, status } });
      // 호출 순서 자체를 못박는다: 잠금 전 읽기 → 잠금 → 잠금 뒤 재조회에서 멈추고,
      // 대상 행(`find-user-for-update`)은 읽지도 않는다. 강등·비활성화 사유별 결과는
      // `admin-access.service.spec.ts`가 따로 덮으므로 여기서 보는 건 이 순서다.
      expect(repository.operations).toEqual([
        'find-actor',
        'lock-active-admins',
        'find-actor',
      ]);
      expect(repository.userUpdates).toEqual([]);
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  // 자기 승격 가드 자체는 여기서 검사하지 않는다 — 실제 저장소는 actor==대상일 때
  // 「대상이 ADMIN이 아닌」 상태를 만들 수 없어서(잠금 뒤 재조회), 서비스를 통과시켜
  // 검사하려면 대역이 불가능한 상태를 꾸며 내야 한다. 가드는
  // `admin-access-mutation-policy.spec.ts`가 순수 함수로 직접 검사한다.
  it('다른 사람을 ADMIN으로 올리는 것은 그대로 허용된다', async () => {
    // Given — 자기 승격 가드가 관리자 임명 자체를 막아 버리면 운영이 멈춘다.
    const repository = new InMemoryAdminAccessRepository();
    repository.actor = adminActor();
    repository.target = accessUser({ role: 'STAFF' });
    const service = new AdminAccessService(
      repository,
      auditLogHarness().service,
    );

    // When
    const result = await service.patchAccess(ADMIN_GITHUB_ID, 'target', {
      expectedRole: 'STAFF',
      desiredRole: 'ADMIN',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: null,
    });

    // Then
    expect(result.role).toBe('ADMIN');
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
