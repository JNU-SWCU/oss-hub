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
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [AuditLogModule, AuthModule, ConsentsModule],
  // 순서가 라우팅 계약이다(#787 회귀) — Express는 컨트롤러를 등록 순서대로 매칭하므로
  // `UsersController`(`/users/me/profile`)가 `AdminAccessController`(`/users/:id/profile`)보다
  // 먼저 와야 `me`가 `:id`로 흡수되지 않는다.
  controllers: [
    AccountDeactivationController,
    UsersController,
    AdminAccessController,
    IndependentAuthorityController,
  ],
  providers: [
    AccountDeactivationRepository,
    AccountDeactivationService,
    AdminAccessRepository,
    AdminAccessService,
    IndependentAuthorityRepository,
    IndependentAuthorityService,
    AdminProfileRepository,
    AdminProfileService,
    UsersRepository,
    UsersService,
  ],
  exports: [UsersService],
})
export class UsersModule {}
