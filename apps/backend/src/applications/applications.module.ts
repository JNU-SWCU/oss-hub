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
import { StudentApplicationManagementRepository } from './student-application-management.repository';
import { StudentApplicationManagementService } from './student-application-management.service';
import { StudentApplicationsController } from './student-applications.controller';

@Module({
  imports: [AuthModule],
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
    {
      provide: StudentApplicationManagementService,
      useFactory: (store: StudentApplicationManagementRepository) =>
        new StudentApplicationManagementService(store),
      inject: [StudentApplicationManagementRepository],
    },
  ],
})
export class ApplicationsModule {}
