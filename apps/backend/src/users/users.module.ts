import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import { AdminAccessController } from './controller/admin-access.controller';
import { AdminAccessRepository } from './repository/admin-access.repository';
import { AdminAccessService } from './service/admin-access.service';
import { AdminProfileRepository } from './repository/admin-profile.repository';
import { AdminProfileService } from './service/admin-profile.service';
import { AccountDeactivationController } from './controller/account-deactivation.controller';
import { AccountDeactivationRepository } from './repository/account-deactivation.repository';
import { AccountDeactivationService } from './service/account-deactivation.service';
import { IndependentAuthorityController } from './controller/independent-authority.controller';
import { IndependentAuthorityRepository } from './repository/independent-authority.repository';
import { IndependentAuthorityService } from './service/independent-authority.service';
import { MemberKindController } from './controller/member-kind.controller';
import { MemberKindRepository } from './repository/member-kind.repository';
import { MemberKindService } from './service/member-kind.service';
import { UsersController } from './controller/users.controller';
import { UsersRepository } from './repository/users.repository';
import { UsersService } from './service/users.service';
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
