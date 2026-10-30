import { ApplicationPreparationsController } from './controller/application-preparations.controller';
import { PlatformModule } from '../platform/platform.module';
import { ApplicationPreparationsService } from './service/application-preparations.service';
import { ApplicationPreparationsRepository } from './repository/application-preparations.repository';
import { Module } from '@nestjs/common';
import { AuditLogService } from '../platform/audit-log.service';
import { AuthModule } from '../auth/auth.module';
import { CollectionModule } from '../github/collection.module';
import { RepositoriesModule } from '../github/repositories.module';
import { ProgramsModule } from '../programs/programs.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { UsersModule } from '../users/users.module';
import { UsersAuthorityService } from '../users/service/authority.service';
import { ApplicationsController } from './controller/applications.controller';
import { ApplicationsRepository } from './repository/applications.repository';
import { ApplicationJoinCodeService } from './service/application-join-code.service';
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
    PlatformModule,
    AuthModule,
    UsersModule,

    CollectionModule,
    RepositoriesModule,
    ProgramsModule,
    SubmissionsModule,
  ],
  controllers: [
    ApplicationPreparationsController,
    StudentRepositoryUrlController,
    StaffDashboardController,
    StudentApplicationsController,
    ProgramApplicationsController,
    ApplicationsController,
  ],
  providers: [
    ApplicationPreparationsService,
    ApplicationPreparationsRepository,
    StudentRepositoryUrlService,
    StudentRepositoryUrlRepository,
    ApplicationsRepository,
    ApplicationJoinCodeService,
    {
      provide: ApplicationsService,
      inject: [
        ApplicationsRepository,
        AuditLogService,
        UsersAuthorityService,
        ApplicationJoinCodeService,
      ],
      useFactory: (
        repository: ApplicationsRepository,
        auditLog: AuditLogService,
        authority: UsersAuthorityService,
        joinCodes: ApplicationJoinCodeService,
      ): ApplicationsService =>
        new ApplicationsService(repository, auditLog, authority, joinCodes),
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
