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
import { StaffRoleRequestsController } from './staff-role-requests.controller';
import { StaffRoleRequestsRepository } from './staff-role-requests.repository';
import { StaffRoleRequestsService } from './staff-role-requests.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersRepository } from './admin-users.repository';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuditLogModule, AuthModule, ConsentsModule, UsersModule],
  controllers: [
    OnboardingController,
    RoleRequestsController,
    StaffRoleRequestsController,
    AdminUsersController,
  ],
  providers: [
    RolesRepository,
    RolesService,
    StaffRoleRequestsRepository,
    StaffRoleRequestsService,
    AdminUsersRepository,
    AdminUsersService,
  ],
})
export class RolesModule {}
