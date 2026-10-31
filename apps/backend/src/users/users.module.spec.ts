import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AccountDeactivationController } from './account-deactivation.controller';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileService } from './admin-profile.service';
import {
  IndependentAuthorityRepository,
  UsersAuthorityRepository,
} from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';
import { MemberKindService } from './member-kind.service';
import { UsersController } from './users.controller';
import { UsersModule } from './users.module';
import { UsersService } from './users.service';
import { UsersAuthorityService } from './users-authority.service';
import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';
import { MemberOnboardingRepository } from './member-onboarding.repository';
import { MemberOnboardingService } from './member-onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { RoleRequestsController } from './role-requests.controller';

describe('UsersModule admin access wiring', () => {
  it('registers the dependencies behind the admin access routes', () => {
    const providers: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      UsersModule,
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
      AdminAccessMutationService,
      AdminAccessService,
      AdminProfileService,
      IndependentAuthorityService,
      MemberKindService,
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
      OnboardingController,
      RoleRequestsController,
      ConsentsController,
    ]);
  });

  it('온보딩 서비스는 자기 저장소를 주입받고 동의 서비스를 명시적으로 주입받는다(PR04H)', () => {
    const providers: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      UsersModule,
    );

    expect(providers).toEqual(
      expect.arrayContaining([
        MemberOnboardingRepository,
        MemberOnboardingService,
      ]),
    );
    expect(
      (
        Reflect.getMetadata(
          'design:paramtypes',
          MemberOnboardingService,
        ) as unknown[]
      )[0],
    ).toBe(MemberOnboardingRepository);
    expect(
      Reflect.getMetadata('self:paramtypes', MemberOnboardingService),
    ).toEqual([{ index: 1, param: ConsentsService }]);
  });
});
