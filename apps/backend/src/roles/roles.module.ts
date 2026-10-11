import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import {
  OnboardingController,
  StaffAccessRequestsController,
} from './controller/roles.controller';
import { RolesRepository } from './repository/roles.repository';
import { RolesService } from './service/roles.service';

@Module({
  imports: [AuditLogModule, AuthModule, ConsentsModule],
  controllers: [OnboardingController, StaffAccessRequestsController],
  providers: [RolesRepository, RolesService],
})
export class RolesModule {}
