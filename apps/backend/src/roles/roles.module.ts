import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import {
  OnboardingController,
  RoleRequestsController,
} from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';

@Module({
  imports: [AuthModule, ConsentsModule],
  controllers: [OnboardingController, RoleRequestsController],
  providers: [RolesRepository, RolesService],
})
export class RolesModule {}
