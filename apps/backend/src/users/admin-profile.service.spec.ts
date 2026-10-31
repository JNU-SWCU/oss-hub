import { AccountStatus } from '@prisma/client';
import { AuthErrorCode } from '../auth/auth-error-code.error';
import { ROLES_ERROR_CODES, RolesErrorCode } from './roles-error-code.error';
import {
  adminActor,
  auditLogHarness,
} from './admin-access.service.spec-support';
import { AdminProfileService } from './admin-profile.service';
import {
  InMemoryAdminProfileRepository,
  profileTarget,
} from './admin-profile.service.spec-support';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { AdminProfileMutationService } from './admin-profile-mutation.service';
import { UserProfileService } from '../platform/user-profile.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';

describe('AdminProfileService.patchProfile', () => {
  it('ADMIN이 아닌 액터는 ADMIN_ONLY(403)로 거부되고 프로필 저장소를 건드리지 않는다', async () => {
    const profileRepository = new InMemoryAdminProfileRepository();
    profileRepository.actor = adminActor({
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    const audit = auditLogHarness();
    const service = new AdminProfileService(
      profileRepository,
      audit.service,
      new AdminProfileMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
        new AdminAccessMutationService(
          new AuditLogMetadataService(),
          new UserProfileService(),
        ),
      ),
    );

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
      adminActor({ hasAdminAccess: false }),
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
      const profileRepository = new InMemoryAdminProfileRepository();
      profileRepository.actor = actor;
      const audit = auditLogHarness();
      const service = new AdminProfileService(
        profileRepository,
        audit.service,
        new AdminProfileMutationService(
          new AuditLogMetadataService(),
          new UserProfileService(),
          new AdminAccessMutationService(
            new AuditLogMetadataService(),
            new UserProfileService(),
          ),
        ),
      );

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
    const profileRepository = new InMemoryAdminProfileRepository();
    profileRepository.target = profileTarget({ name: '기존 이름' });
    const audit = auditLogHarness();
    const service = new AdminProfileService(
      profileRepository,
      audit.service,
      new AdminProfileMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
        new AdminAccessMutationService(
          new AuditLogMetadataService(),
          new UserProfileService(),
        ),
      ),
    );

    const result = await service.patchProfile(9_131_500_002n, 'target', {
      name: '새 이름',
    });

    expect(result.name).toBe('새 이름');
    expect(profileRepository.legacyFieldsApplied).toEqual([
      { name: '새 이름' },
    ]);

    expect(profileRepository.operations).toEqual([
      'lock-active-admins',
      'find-actor',
      'find-target',
    ]);
  });
});
