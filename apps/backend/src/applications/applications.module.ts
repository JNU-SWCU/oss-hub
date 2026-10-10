import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/service/audit-log.service';
import { AuthModule } from '../auth/auth.module';
import { CollectionModule } from '../github/collection.module';
import { RepositoriesModule } from '../github/repositories.module';
import { ProgramsModule } from '../programs/programs.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { UsersModule } from '../users/users.module';
import { UsersAuthorityService } from '../users/service/authority.service';
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
import { ConsentsModule } from '../consents/consents.module';
import { StudentRepositoryUrlController } from './student-repository-url.controller';
import { StudentRepositoryUrlService } from './student-repository-url.service';
import { StudentRepositoryUrlRepository } from './student-repository-url.repository';

@Module({
  imports: [
    ConsentsModule,
    AuditLogModule,
    AuthModule,
    UsersModule,

    CollectionModule,
    RepositoriesModule,
    ProgramsModule,
    SubmissionsModule,
  ],
  controllers: [
    StudentRepositoryUrlController,
    StaffDashboardController,
    StudentApplicationsController,
    ProgramApplicationsController,
    ApplicationsController,
  ],
  providers: [
    StudentRepositoryUrlService,
    StudentRepositoryUrlRepository,
    ApplicationsRepository,
    {
      provide: ApplicationsService,
      inject: [ApplicationsRepository, AuditLogService, UsersAuthorityService],
      useFactory: (
        repository: ApplicationsRepository,
        auditLog: AuditLogService,
        authority: UsersAuthorityService,
      ): ApplicationsService =>
        new ApplicationsService(repository, auditLog, authority),
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
