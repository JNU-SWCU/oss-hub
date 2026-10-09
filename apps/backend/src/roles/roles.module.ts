import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import {
  OnboardingController,
  StaffAccessRequestsController,
} from './controller/roles.controller';
import { UsersModule } from '../users/users.module';
import { RolesService } from './service/roles.service';

@Module({
  imports: [AuditLogModule, AuthModule, ConsentsModule, UsersModule],
  controllers: [OnboardingController, StaffAccessRequestsController],
  providers: [RolesService],
})
export class RolesModule {}
