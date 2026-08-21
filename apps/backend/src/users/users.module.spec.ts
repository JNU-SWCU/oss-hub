import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AccountDeactivationController } from './account-deactivation.controller';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { IndependentAuthorityController } from './independent-authority.controller';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';
import { LegacyMemberReclassificationController } from './legacy-member-reclassification.controller';
import { LegacyMemberReclassificationRepository } from './legacy-member-reclassification.repository';
import { LegacyMemberReclassificationService } from './legacy-member-reclassification.service';
import { UsersController } from './users.controller';
import { UsersModule } from './users.module';

describe('UsersModule admin access wiring', () => {
  it('registers the controller and dependencies for the access routes', () => {
    // Given
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      UsersModule,
    );
    const providers: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      UsersModule,
    );

    // When / Then
    expect(controllers).toEqual(
      expect.arrayContaining([
        AdminAccessController,
        IndependentAuthorityController,
        LegacyMemberReclassificationController,
      ]),
    );
    expect(providers).toEqual(
      expect.arrayContaining([
        AdminAccessRepository,
        AdminAccessService,
        IndependentAuthorityRepository,
        IndependentAuthorityService,
        LegacyMemberReclassificationRepository,
        LegacyMemberReclassificationService,
      ]),
    );
  });

  it('통합 접근 경로로 전환한 뒤에는 레거시 admin-users 컨트롤러를 다시 등록하지 않는다(PR04H)', () => {
    // Given
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      UsersModule,
    );

    // When / Then — 자기 계정 비활성화, /admin/access, /users 조회 경로만 남고
    // 원자적 전환으로 제거된 레거시 /users(list)·/users/:id/role 쓰기
    // 컨트롤러는 다시 등록되지 않는다.
    expect(controllers).toEqual([
      AccountDeactivationController,
      UsersController,
      LegacyMemberReclassificationController,
      AdminAccessController,
      IndependentAuthorityController,
    ]);
  });

  it('UsersController가 AdminAccessController보다 먼저 등록되어 /users/me/profile 흡수를 막는다(#787)', () => {
    // Given
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      UsersModule,
    );

    // When / Then — Express는 등록 순서대로 매칭하므로 `/users/me/profile`이
    // `AdminAccessController`의 `/users/:id/profile`에 흡수되지 않으려면
    // `UsersController`가 먼저 와야 한다.
    const list = controllers as unknown[];
    expect(list.indexOf(UsersController)).toBeLessThan(
      list.indexOf(AdminAccessController),
    );
  });
});
