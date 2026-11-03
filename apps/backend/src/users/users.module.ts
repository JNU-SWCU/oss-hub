import { MemberKindProfileService } from './member-kind-profile.service';
import { AdminRepository } from './admin.repository';
import { UserHistoryRepository } from './user-history.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { UserPolicyRepository } from './user-policy.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { AdminProfileService } from './admin-profile.service';
import { AccountDeactivationController } from './account-deactivation.controller';
import { AccountDeactivationRepository } from './account-deactivation.repository';
import { AccountDeactivationService } from './account-deactivation.service';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';
import { MemberKindRepository } from './member-kind.repository';
import { MemberKindService } from './member-kind.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { UserProfileService } from './user-profile.service';
import { ConsentsController } from './consents.controller';
import { MemberOnboardingRepository } from './member-onboarding.repository';
import { ConsentsService } from './consents.service';
import { MemberOnboardingService } from './member-onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { RoleRequestsController } from './role-requests.controller';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { AdminProfileMutationService } from './admin-profile-mutation.service';

@Module({
  imports: [PlatformModule],

  controllers: [
    AccountDeactivationController,
    UsersController,
    OnboardingController,
    RoleRequestsController,
    ConsentsController,
  ],
  providers: [
    AdminRepository,
    UserPolicyRepository,
    UserHistoryRepository,
    UserTransitionRepository,
    AdminAccessReadOrderingRepository,
    AdminAccessReadRepository,
    AdminAccessHistoryRepository,
    AccountDeactivationRepository,
    AccountDeactivationService,
    AdminAccessRepository,
    AdminAccessMutationService,
    AdminAccessService,
    IndependentAuthorityRepository,
    IndependentAuthorityService,
    MemberKindRepository,
    MemberKindService,
    MemberKindProfileService,
    AdminProfileRepository,
    AdminProfileMutationService,
    AdminProfileService,
    UsersRepository,
    UsersService,
    ConsentsService,
    MemberOnboardingRepository,
    MemberOnboardingService,
    UserProfileService,
  ],
  exports: [
    UsersService,
    ConsentsService,
    AdminAccessMutationService,
    AdminAccessService,
    AdminProfileService,
    IndependentAuthorityService,
    MemberKindService,
    UserProfileService,
  ],
})
export class UsersModule {}
