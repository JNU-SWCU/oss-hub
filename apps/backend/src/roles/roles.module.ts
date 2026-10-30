import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import {
  OnboardingController,
  StaffAccessRequestsController,
} from './controller/roles.controller';
import { RolesRepository } from './repository/roles.repository';
import { RolesService } from './service/roles.service';

@Module({
  imports: [PlatformModule, AuthModule, ConsentsModule],
  controllers: [OnboardingController, StaffAccessRequestsController],
  providers: [RolesRepository, RolesService],
})
export class RolesModule {}
