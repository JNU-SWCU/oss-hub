import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import { UsersModule } from '../users/users.module';
import {
  OnboardingController,
  RoleRequestsController,
} from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';

@Module({
  imports: [AuditLogModule, AuthModule, ConsentsModule, UsersModule],
  controllers: [OnboardingController, RoleRequestsController],
  providers: [RolesRepository, RolesService],
})
export class RolesModule {}
