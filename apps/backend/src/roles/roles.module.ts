import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import {
  OnboardingController,
  RoleRequestsController,
} from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';
import { StaffRoleRequestsController } from './staff-role-requests.controller';
import { StaffRoleRequestsRepository } from './staff-role-requests.repository';
import { StaffRoleRequestsService } from './staff-role-requests.service';

@Module({
  imports: [AuthModule, ConsentsModule],
  controllers: [
    OnboardingController,
    RoleRequestsController,
    StaffRoleRequestsController,
  ],
  providers: [
    RolesRepository,
    RolesService,
    StaffRoleRequestsRepository,
    StaffRoleRequestsService,
  ],
})
export class RolesModule {}
