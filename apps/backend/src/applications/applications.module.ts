import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthModule } from '../auth/auth.module';
import { RepositoriesModule } from '../github/repositories.module';
import { OwnRepositoryUrlValidationService } from '../github/service/own-repository-url-validation.service';
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
import { StaffInsightsRepository } from './staff-insights.repository';
import { StaffInsightsService } from './staff-insights.service';
import {
  StudentApplicationManagementRepository,
  STUDENT_APPLICATION_MANAGEMENT_CLOCK,
} from './student-application-management.repository';
import { StudentApplicationManagementService } from './student-application-management.service';
import { StudentApplicationsController } from './student-applications.controller';

@Module({
  imports: [
    AuditLogModule,
    AuthModule,
    RepositoriesModule,
    ProgramsModule,
    SubmissionsModule,
  ],
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
    {
      // ApplicationsService.ownRepositoryUrlValidator는 Pick<> 타입이라(#9 QA
      // econovation 배치 — 단위 테스트가 fake로 쉽게 직열하게 하려고) TypeScript가
      // design:paramtypes에 `Object`를 남긴다 — 암묵적 타입 기반 DI가 해결하지
      // 못해 명시적 factory로 주입한다.
      provide: ApplicationsService,
      inject: [
        ApplicationsRepository,
        AuditLogService,
        OwnRepositoryUrlValidationService,
      ],
      useFactory: (
        repository: ApplicationsRepository,
        auditLog: AuditLogService,
        ownRepositoryUrlValidator: OwnRepositoryUrlValidationService,
      ): ApplicationsService =>
        new ApplicationsService(
          repository,
          auditLog,
          ownRepositoryUrlValidator,
        ),
    },
    StudentApplicationManagementRepository,
    StudentApplicationManagementService,
    StaffDashboardService,
    StaffInsightsRepository,
    StaffInsightsService,
    {
      provide: STUDENT_APPLICATION_MANAGEMENT_CLOCK,
      useValue: () => new Date(),
    },
  ],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
