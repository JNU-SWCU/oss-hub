import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { RepositoriesModule } from '../github/repositories.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { ProgramAuthoringController } from './controller/program-authoring.controller';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import { ProgramAuthoringUploadMaintenanceScheduler } from './program-authoring-upload-maintenance.scheduler';
import { ProgramPurgeFileCleanupScheduler } from './program-purge-file-cleanup.scheduler';
import { ProgramPurgeFileCleanupService } from './program-purge-file-cleanup.service';
import { ProgramPurgeFileCleanupRepository } from './repository/program-purge-file-cleanup.repository';
import { ProgramAuthoringUploadMaintenanceService } from './program-authoring-upload-maintenance.service';
import { ProgramAuthoringUploadRepository } from './program-authoring-upload.repository';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import { ApplicationTemplatesController } from './controller/application-templates.controller';
import { MilestonesController } from './controller/milestones.controller';
import { ProgramCreationService } from './service/program-creation.service';
import { PROGRAM_ACTIVITY_SUMMARY_PORT } from './program-activity-summary.port';
import { ProgramActivityRepository } from './repository/program-activity.repository';
import { ProgramActivitySummaryRepository } from './repository/program-activity-summary.repository';
import { ProgramActivitySummaryService } from './service/program-activity-summary.service';
import { ProgramActivityService } from './service/program-activity.service';
import { ProgramEditorController } from './controller/program-editor.controller';
import { ProgramEditorRepository } from './repository/program-editor.repository';
import { ProgramEditorService } from './service/program-editor.service';
import { ProgramLifecycleService } from './service/program-lifecycle.service';
import { ProgramTeamsStaffGuard } from './program-teams-staff.guard';
import { ProgramTeamsController } from './controller/program-teams.controller';
import { ProgramTeamsRepository } from './repository/program-teams.repository';
import { ProgramTeamsService } from './service/program-teams.service';
import { ProgramViewerService } from './service/program-viewer.service';
import {
  ProgramsController,
  StudentDashboardController,
} from './controller/programs.controller';
import { ProgramsRepository } from './repository/programs.repository';
import { ProgramsService } from './service/programs.service';
import { StudentDashboardService } from './service/student-dashboard.service';

@Module({
  imports: [AuthModule, AuditLogModule, RepositoriesModule, SubmissionsModule],
  controllers: [
    // static sibling first — programs/application-templates before programs/:id
    ApplicationTemplatesController,
    ProgramAuthoringController,
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
    ProgramAuthoringUploadRepository,
    ProgramAuthoringUploadService,
    ProgramAuthoringUploadMaintenanceService,
    ProgramAuthoringUploadMaintenanceScheduler,
    ProgramPurgeFileCleanupRepository,
    ProgramPurgeFileCleanupService,
    ProgramPurgeFileCleanupScheduler,
    ProgramActivityRepository,
    ProgramActivitySummaryRepository,
    ProgramActivitySummaryService,
    {
      provide: PROGRAM_ACTIVITY_SUMMARY_PORT,
      useExisting: ProgramActivitySummaryService,
    },
    ProgramActivityService,
    ProgramViewerService,
    StudentDashboardService,
    ProgramEditorService,
    ProgramEditorRepository,
    ProgramLifecycleService,
    ProgramTeamsService,
    ProgramTeamsRepository,
    ProgramTeamsStaffGuard,
  ],
  exports: [
    PROGRAM_ACTIVITY_SUMMARY_PORT,
    ProgramAuthoringService,
    ProgramAuthoringUploadService,
    ProgramAuthoringUploadMaintenanceService,
  ],
})
export class ProgramsModule {}
