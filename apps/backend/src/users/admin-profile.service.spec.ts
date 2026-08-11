import { AccountStatus, Role } from '@prisma/client';
import { AuthErrorCode } from '../auth/auth-error-code.enum';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../roles/roles-error-code.enum';
import {
  adminActor,
  auditLogHarness,
} from './admin-access.service.spec-support';
import { AdminProfileService } from './admin-profile.service';
import {
  InMemoryAdminProfileRepository,
  profileTarget,
} from './admin-profile.service.spec-support';

describe('AdminProfileService.patchProfile', () => {
  it('ADMIN이 아닌 액터는 ADMIN_ONLY(403)로 거부되고 프로필 저장소를 건드리지 않는다', async () => {
    // Given
    const profileRepository = new InMemoryAdminProfileRepository();
    profileRepository.actor = adminActor({
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    });
    const audit = auditLogHarness();
    const service = new AdminProfileService(profileRepository, audit.service);

    // When / Then
    await expect(
      service.patchProfile(9_131_500_002n, 'target', { name: '새 이름' }),
    ).rejects.toMatchObject({
      errorCode: ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY],
    });
    expect(profileRepository.legacyFieldsApplied).toHaveLength(0);
    expect(profileRepository.profileFieldsApplied).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled();
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
    '%s actor는 트랜잭션 안 재검증에서 거부되고 대상 조회조차 하지 않는다',
    async (_label, actor, code, status) => {
      // Given — 권한 판정이 트랜잭션 밖에 있으면 강등된 뒤에도 수정이 완주한다(#687).
      const profileRepository = new InMemoryAdminProfileRepository();
      profileRepository.actor = actor;
      const audit = auditLogHarness();
      const service = new AdminProfileService(profileRepository, audit.service);

      // When / Then
      await expect(
        service.patchProfile(9_131_500_002n, 'target', { name: '새 이름' }),
      ).rejects.toMatchObject({ errorCode: { code, status } });
      expect(profileRepository.operations).toEqual([
        'lock-active-admins',
        'find-actor',
      ]);
      expect(profileRepository.legacyFieldsApplied).toHaveLength(0);
      expect(profileRepository.profileFieldsApplied).toHaveLength(0);
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('활성 ADMIN 액터는 프로필 갱신을 프로필 저장소로 위임한다', async () => {
    // Given
    const profileRepository = new InMemoryAdminProfileRepository();
    profileRepository.target = profileTarget({ name: '기존 이름' });
    const audit = auditLogHarness();
    const service = new AdminProfileService(profileRepository, audit.service);

    // When
    const result = await service.patchProfile(9_131_500_002n, 'target', {
      name: '새 이름',
    });

    // Then
    expect(result.name).toBe('새 이름');
    expect(profileRepository.legacyFieldsApplied).toEqual([
      { name: '새 이름' },
    ]);
    // 잠금 → actor 재검증 → 대상 조회 순서다. 뒤집히면 잠기지 않은 값으로 판정하게 된다.
    expect(profileRepository.operations).toEqual([
      'lock-active-admins',
      'find-actor',
      'find-target',
    ]);
  });
});
