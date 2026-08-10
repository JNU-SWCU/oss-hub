import { AccountStatus, Role } from '@prisma/client';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../roles/roles-error-code.enum';
import {
  adminActor,
  auditLogHarness,
} from './admin-access.service.spec-support';
import type { AdminAccessRepositoryPort } from './admin-access.repository';
import { AdminProfileService } from './admin-profile.service';
import {
  InMemoryAdminProfileRepository,
  profileTarget,
} from './admin-profile.service.spec-support';

describe('AdminProfileService.patchProfile', () => {
  it('ADMIN이 아닌 액터는 ADMIN_ONLY(403)로 거부되고 프로필 저장소를 건드리지 않는다', async () => {
    // Given
    const accessRepository = {
      findActorByGithubId: jest.fn().mockResolvedValue(
        adminActor({
          role: Role.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
        }),
      ),
    } as unknown as Pick<AdminAccessRepositoryPort, 'findActorByGithubId'>;
    const profileRepository = new InMemoryAdminProfileRepository();
    const audit = auditLogHarness();
    const service = new AdminProfileService(
      accessRepository as AdminAccessRepositoryPort,
      profileRepository,
      audit.service,
    );

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

  it('활성 ADMIN 액터는 프로필 갱신을 프로필 저장소로 위임한다', async () => {
    // Given
    const accessRepository = {
      findActorByGithubId: jest.fn().mockResolvedValue(adminActor()),
    } as unknown as Pick<AdminAccessRepositoryPort, 'findActorByGithubId'>;
    const profileRepository = new InMemoryAdminProfileRepository();
    profileRepository.target = profileTarget({ name: '기존 이름' });
    const audit = auditLogHarness();
    const service = new AdminProfileService(
      accessRepository as AdminAccessRepositoryPort,
      profileRepository,
      audit.service,
    );

    // When
    const result = await service.patchProfile(9_131_500_002n, 'target', {
      name: '새 이름',
    });

    // Then
    expect(result.name).toBe('새 이름');
    expect(profileRepository.legacyFieldsApplied).toEqual([
      { name: '새 이름' },
    ]);
  });
});
