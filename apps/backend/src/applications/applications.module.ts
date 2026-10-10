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
import { ApplicationsController } from './controller/applications.controller';
import { ApplicationsRepository } from './repository/applications.repository';
import { ApplicationsService } from './service/applications.service';
import { ProgramApplicationsController } from './controller/program-applications.controller';
import { StaffDashboardController } from './controller/staff-dashboard.controller';
import { StaffDashboardService } from './service/staff-dashboard.service';
import { StaffInsightsRepository } from './repository/staff-insights.repository';
import { StaffInsightsService } from './service/staff-insights.service';
import {
  StudentApplicationManagementRepository,
  STUDENT_APPLICATION_MANAGEMENT_CLOCK,
} from './repository/student-application-management.repository';
import { StudentApplicationManagementService } from './service/student-application-management.service';
import { StudentApplicationsController } from './controller/student-applications.controller';
import { ConsentsModule } from '../consents/consents.module';
import { StudentRepositoryUrlController } from './controller/student-repository-url.controller';
import { StudentRepositoryUrlService } from './service/student-repository-url.service';
import { StudentRepositoryUrlRepository } from './repository/student-repository-url.repository';

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
