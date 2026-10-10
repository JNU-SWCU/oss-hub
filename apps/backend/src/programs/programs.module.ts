import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { RepositoriesModule } from '../github/repositories.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { ProgramAuthoringController } from './controller/program-authoring.controller';
import { ProgramAuthoringRepository } from './repository/program-authoring.repository';
import { ProgramAuthoringService } from './service/program-authoring.service';
import { ProgramAuthoringUploadMaintenanceScheduler } from './job/program-authoring-upload-maintenance.scheduler';
import { ProgramPurgeFileCleanupScheduler } from './job/program-purge-file-cleanup.scheduler';
import { ProgramPurgeFileCleanupService } from './service/program-purge-file-cleanup.service';
import { ProgramPurgeFileCleanupRepository } from './repository/program-purge-file-cleanup.repository';
import { ProgramAuthoringUploadMaintenanceService } from './service/program-authoring-upload-maintenance.service';
import { ProgramAuthoringUploadRepository } from './repository/program-authoring-upload.repository';
import { ProgramAuthoringUploadService } from './service/program-authoring-upload.service';
import { ApplicationTemplatesController } from './controller/application-templates.controller';
import { MilestonesController } from './controller/milestones.controller';
import { ProgramCreationService } from './service/program-creation.service';
import { ProgramActivityRepository } from './repository/program-activity.repository';
import { ProgramActivitySummaryRepository } from './repository/program-activity-summary.repository';
import { ProgramActivitySummaryService } from './service/program-activity-summary.service';
import { ProgramActivityService } from './service/program-activity.service';
import { ProgramEditorController } from './controller/program-editor.controller';
import { ProgramEditorRepository } from './repository/program-editor.repository';
import { ProgramEditorService } from './service/program-editor.service';
import { ProgramLifecycleRepository } from './repository/program-lifecycle.repository';
import { ProgramLifecycleService } from './service/program-lifecycle.service';
import { ProgramTeamsController } from './controller/program-teams.controller';
import { ProgramTeamDeletionRepository } from './repository/program-team-deletion.repository';
import { ProgramTeamsRepository } from './repository/program-teams.repository';
import { ProgramTeamsService } from './service/program-teams.service';
import { ProgramViewerService } from './service/program-viewer.service';
import {
  ProgramsController,
  StudentDashboardController,
} from './controller/programs.controller';
import { ProgramsRepository } from './repository/programs.repository';
import { StudentDashboardReadRepository } from './repository/student-dashboard-read.repository';
import { ProgramsService } from './service/programs.service';
import { StudentDashboardService } from './service/student-dashboard.service';
import { ProgramCoverController } from './controller/program-cover.controller';
import { ProgramCoverService } from './service/program-cover.service';
import { ProgramCoverRepository } from './repository/program-cover.repository';
import { ProgramNoticePreviewController } from './controller/program-notice-preview.controller';
import { ProgramNoticePreviewService } from './service/program-notice-preview.service';
import { ProgramNoticeFetchClient } from './gateway/program-notice-fetch.client';

@Module({
  imports: [
    AuthModule,
    AuditLogModule,
    RepositoriesModule,
    SubmissionsModule,
    StorageModule,
    UsersModule,
  ],
  controllers: [
    ApplicationTemplatesController,
    ProgramNoticePreviewController,
    ProgramAuthoringController,
    ProgramCoverController,
    ProgramsController,
    StudentDashboardController,
    ProgramEditorController,
    MilestonesController,
    ProgramTeamsController,
  ],
  providers: [
    ProgramsService,
    ProgramsRepository,
    ProgramCreationService,
    ProgramAuthoringRepository,
    ProgramAuthoringService,
    ProgramNoticePreviewService,
    ProgramNoticeFetchClient,
    ProgramAuthoringUploadRepository,
    ProgramAuthoringUploadService,
    ProgramCoverService,
    ProgramCoverRepository,
    ProgramAuthoringUploadMaintenanceService,
    ProgramAuthoringUploadMaintenanceScheduler,
    ProgramPurgeFileCleanupRepository,
    ProgramPurgeFileCleanupService,
    ProgramPurgeFileCleanupScheduler,
    ProgramActivityRepository,
    ProgramActivitySummaryRepository,
    ProgramActivitySummaryService,
    ProgramActivityService,
    ProgramViewerService,
    StudentDashboardReadRepository,
    StudentDashboardService,
    ProgramEditorService,
    ProgramEditorRepository,
    ProgramLifecycleService,
    ProgramLifecycleRepository,
    ProgramTeamsService,
    ProgramTeamsRepository,
    ProgramTeamDeletionRepository,
  ],
  exports: [
    ProgramActivitySummaryService,
    ProgramAuthoringService,
    ProgramAuthoringUploadService,
    ProgramAuthoringUploadMaintenanceService,
  ],
})
export class ProgramsModule {}
