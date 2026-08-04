import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
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
import {
  StudentApplicationManagementRepository,
  STUDENT_APPLICATION_MANAGEMENT_CLOCK,
} from './student-application-management.repository';
import { StudentApplicationManagementService } from './student-application-management.service';
import { StudentApplicationsController } from './student-applications.controller';

@Module({
  imports: [AuditLogModule, AuthModule, ProgramsModule, SubmissionsModule],
  controllers: [
    StaffDashboardController,
    StudentApplicationsController,
    ProgramApplicationsController,
    ApplicationsController,
  ],
  providers: [
    ApplicationsStaffGuard,
    ApplicationsStaffListGuard,
    ApplicationsRepository,
    ApplicationsService,
    StudentApplicationManagementRepository,
    StudentApplicationManagementService,
    StaffDashboardService,
    {
      provide: STUDENT_APPLICATION_MANAGEMENT_CLOCK,
      useValue: () => new Date(),
    },
  ],
})
export class ApplicationsModule {}
