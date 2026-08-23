import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import {
  OnboardingController,
  StaffAccessRequestsController,
} from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';

@Module({
  // UsersModule은 더 이상 필요하지 않다 — 역할 배정이 프로필 완료를 요구하지 않는다.
  imports: [AuditLogModule, AuthModule, ConsentsModule],
  controllers: [OnboardingController, StaffAccessRequestsController],
  providers: [RolesRepository, RolesService],
})
export class RolesModule {}
