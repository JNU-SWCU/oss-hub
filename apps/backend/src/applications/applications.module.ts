import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  ApplicationsStaffGuard,
  ApplicationsStaffListGuard,
} from './applications-staff.guard';
import { ApplicationsController } from './applications.controller';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationsService } from './applications.service';
import { ProgramApplicationsController } from './program-applications.controller';
import { StaffDashboardController } from './staff-dashboard.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    StaffDashboardController,
    ProgramApplicationsController,
    ApplicationsController,
  ],
  providers: [
    ApplicationsStaffGuard,
    ApplicationsStaffListGuard,
    ApplicationsRepository,
    ApplicationsService,
  ],
})
export class ApplicationsModule {}
