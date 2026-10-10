import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
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
import { UsersAuthorityRepository } from './repository/authority.repository';
import { UsersAuthorityService } from './service/authority.service';
import { UsersOnboardingRepository } from './repository/onboarding.repository';
import { UsersOnboardingService } from './service/onboarding.service';

@Module({
  imports: [AuditLogModule, AuthModule, ConsentsModule],

  controllers: [
    AccountDeactivationController,
    UsersController,
    AdminAccessController,
    IndependentAuthorityController,
    MemberKindController,
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
    UsersOnboardingRepository,
    UsersOnboardingService,
  ],
  exports: [UsersService, UsersAuthorityService, UsersOnboardingService],
})
export class UsersModule {}
