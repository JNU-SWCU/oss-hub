import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AccountDeactivationController } from './account-deactivation.controller';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { IndependentAuthorityController } from './independent-authority.controller';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';
import { MemberKindController } from './member-kind.controller';
import { UsersController } from './users.controller';
import { UsersModule } from './users.module';
import { UsersService } from './users.service';
import { UsersAuthorityRepository } from './authority.repository';
import { UsersAuthorityService } from './authority.service';
import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';
import { RolesRepository } from './member-onboarding.repository';
import { RolesService } from './member-onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { StaffAccessRequestsController } from './role-requests.controller';

describe('UsersModule admin access wiring', () => {
  it('registers the controller and dependencies for the access routes', () => {
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      UsersModule,
    );
    const providers: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      UsersModule,
    );

    expect(controllers).toEqual(
      expect.arrayContaining([
        AdminAccessController,
        IndependentAuthorityController,
      ]),
    );
    expect(providers).toEqual(
      expect.arrayContaining([
        AdminAccessRepository,
        AdminAccessService,
        IndependentAuthorityRepository,
        IndependentAuthorityService,
        UsersAuthorityRepository,
        UsersAuthorityService,
      ]),
    );
  });

  it('exports only user capabilities, never their repositories', () => {
    const exports: unknown = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      UsersModule,
    );

    expect(exports).toEqual([
      UsersService,
      UsersAuthorityService,
      ConsentsService,
    ]);
  });

  it('통합 접근 경로로 전환한 뒤에는 레거시 admin-users 컨트롤러를 다시 등록하지 않는다(PR04H)', () => {
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      UsersModule,
    );

    expect(controllers).toEqual([
      AccountDeactivationController,
      UsersController,
      AdminAccessController,
      IndependentAuthorityController,
      MemberKindController,
      OnboardingController,
      StaffAccessRequestsController,
      ConsentsController,
    ]);
  });

  it('온보딩 서비스는 자기 저장소를 주입받고 동의 서비스를 명시적으로 주입받는다(PR04H)', () => {
    const providers: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      UsersModule,
    );

    expect(providers).toEqual(
      expect.arrayContaining([RolesRepository, RolesService]),
    );
    expect(
      (Reflect.getMetadata('design:paramtypes', RolesService) as unknown[])[0],
    ).toBe(RolesRepository);
    expect(Reflect.getMetadata('self:paramtypes', RolesService)).toEqual([
      { index: 1, param: ConsentsService },
    ]);
  });

  it('UsersController가 AdminAccessController보다 먼저 등록되어 /users/me/profile 흡수를 막는다(#787)', () => {
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      UsersModule,
    );

    const list = controllers as unknown[];
    expect(list.indexOf(UsersController)).toBeLessThan(
      list.indexOf(AdminAccessController),
    );
  });
});
