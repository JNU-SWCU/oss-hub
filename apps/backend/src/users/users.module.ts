import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AuthModule } from '../auth/auth.module';
import { PublicProjectsModule } from '../programs/public/public-projects/public-projects.module';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { AdminProfileService } from './admin-profile.service';
import { AccountDeactivationController } from './account-deactivation.controller';
import { AccountDeactivationRepository } from './account-deactivation.repository';
import { AccountDeactivationService } from './account-deactivation.service';
import { IndependentAuthorityController } from './independent-authority.controller';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';
import { MemberKindController } from './member-kind.controller';
import { MemberKindRepository } from './member-kind.repository';
import { MemberKindService } from './member-kind.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { UsersAuthorityRepository } from './authority.repository';
import { UsersAuthorityService } from './authority.service';
import { ConsentsController } from './consents.controller';
import { ConsentsRepository } from './consents.repository';
import { ConsentsService } from './consents.service';
import { RolesRepository } from './member-onboarding.repository';
import { RolesService } from './member-onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { PublicUserProfileController } from './public-profile.controller';
import { StaffAccessRequestsController } from './role-requests.controller';

@Module({
  imports: [PlatformModule, AuthModule, PublicProjectsModule],

  controllers: [
    AccountDeactivationController,
    UsersController,
    AdminAccessController,
    IndependentAuthorityController,
    MemberKindController,
    OnboardingController,
    StaffAccessRequestsController,
    ConsentsController,
    PublicUserProfileController,
  ],
  providers: [
    AccountDeactivationRepository,
    AccountDeactivationService,
    AdminAccessRepository,
    AdminAccessService,
    IndependentAuthorityRepository,
    IndependentAuthorityService,
    MemberKindRepository,
    MemberKindService,
    AdminProfileRepository,
    AdminProfileService,
    UsersRepository,
    UsersService,
    UsersAuthorityRepository,
    UsersAuthorityService,
    ConsentsService,
    ConsentsRepository,
    RolesRepository,
    RolesService,
  ],
  exports: [UsersService, UsersAuthorityService, ConsentsService],
})
export class UsersModule {}
