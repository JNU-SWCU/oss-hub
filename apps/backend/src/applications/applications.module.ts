import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProgramsModule } from '../programs/programs.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import {
  ApplicationsStaffGuard,
  ApplicationsStaffListGuard,
} from './applications-staff.guard';
import { ApplicationsController } from './applications.controller';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationsService } from './applications.service';
import { ProgramApplicationsController } from './program-applications.controller';
import { StaffDashboardController } from './staff-dashboard.controller';
import { StaffDashboardService } from './staff-dashboard.service';

@Module({
  imports: [AuthModule, ProgramsModule, SubmissionsModule],
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
    StaffDashboardService,
  ],
})
export class ApplicationsModule {}
