import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AccountDeactivationController } from './controller/account-deactivation.controller';
import { AdminAccessController } from './controller/admin-access.controller';
import { AdminAccessRepository } from './repository/admin-access.repository';
import { AdminAccessService } from './service/admin-access.service';
import { IndependentAuthorityController } from './controller/independent-authority.controller';
import { IndependentAuthorityRepository } from './repository/independent-authority.repository';
import { IndependentAuthorityService } from './service/independent-authority.service';
import { MemberKindController } from './controller/member-kind.controller';
import { UsersController } from './controller/users.controller';
import { UsersModule } from './users.module';
import { UsersService } from './service/users.service';
import { UsersAuthorityRepository } from './repository/authority.repository';
import { UsersAuthorityService } from './service/authority.service';
import { UsersOnboardingRepository } from './repository/onboarding.repository';
import { UsersOnboardingService } from './service/onboarding.service';

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
        UsersOnboardingRepository,
        UsersOnboardingService,
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
      UsersOnboardingService,
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
