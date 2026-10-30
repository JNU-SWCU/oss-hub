import { ProgramLifecycleController } from './program-lifecycle.controller';
import { PlatformModule } from '../platform/platform.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RepositoriesModule } from '../github/repositories.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { UsersModule } from '../users/users.module';
import { ProgramAuthoringController } from './program-authoring.controller';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { ProgramAuthoringService } from './program-authoring.service';
import { ProgramAuthoringUploadMaintenanceScheduler } from './program-authoring-upload-maintenance.scheduler';
import { ProgramPurgeFileCleanupScheduler } from './program-purge-file-cleanup.scheduler';
import { ProgramPurgeFileCleanupService } from './program-purge-file-cleanup.service';
import { ProgramPurgeFileCleanupRepository } from './program-purge-file-cleanup.repository';
import { ProgramAuthoringUploadMaintenanceService } from './program-authoring-upload-maintenance.service';
import { ProgramAuthoringUploadRepository } from './program-authoring-upload.repository';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import { ApplicationTemplatesController } from './application-templates.controller';
import { MilestonesController } from './milestones.controller';
import { ProgramCreationService } from './program-creation.service';
import { ProgramActivityRepository } from './program-activity.repository';
import { ProgramActivitySummaryRepository } from './program-activity-summary.repository';
import { ProgramActivitySummaryService } from './program-activity-summary.service';
import { ProgramActivityService } from './program-activity.service';
import { ProgramEditorController } from './program-editor.controller';
import { ProgramEditorRepository } from './program-editor.repository';
import { ProgramEditorService } from './program-editor.service';
import { ProgramLifecycleRepository } from './program-lifecycle.repository';
import { ProgramLifecycleService } from './program-lifecycle.service';
import { ProgramTeamsController } from './program-teams.controller';
import { ProgramTeamDeletionRepository } from './program-team-deletion.repository';
import { ProgramTeamsRepository } from './program-teams.repository';
import { ProgramTeamsService } from './program-teams.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsController } from './programs.controller';
import { StudentDashboardController } from './student-dashboard.controller';
import { ProgramsRepository } from './programs.repository';
import { StudentDashboardReadRepository } from './student-dashboard-read.repository';
import { ProgramsService } from './programs.service';
import { StudentDashboardService } from './student-dashboard.service';
import { ProgramCoverController } from './program-cover.controller';
import { ProgramCoverService } from './program-cover.service';
import { ProgramCoverRepository } from './program-cover.repository';
import { ProgramNoticePreviewController } from './program-notice-preview.controller';
import { ProgramNoticePreviewService } from './program-notice-preview.service';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { BoardController } from './board.controller';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';
import { ProgramOverviewController } from './program-overview.controller';
import { ProgramOverviewRepository } from './program-overview.repository';
import { ProgramOverviewService } from './program-overview.service';
import { PublicEligibilityRepository } from './public-eligibility.repository';
import { PublicEligibilityService } from './public-eligibility.service';
import { PublicProjectMetricsRepository } from './public-project-metrics.repository';
import { PublicProjectsController } from './public-projects.controller';
import { PublicProjectsRepository } from './public-projects.repository';
import { PublicProjectsService } from './public-projects.service';
import { PublicUserProfileController } from './public-profile.controller';
import { TeamInvitationsController } from './team-invitations.controller';
import { TeamInvitationsRepository } from './team-invitations.repository';
import { TeamInvitationsService } from './team-invitations.service';

@Module({
  imports: [
    AuthModule,
    PlatformModule,
    RepositoriesModule,
    SubmissionsModule,
    UsersModule,
  ],
  controllers: [
    ApplicationTemplatesController,
    ProgramNoticePreviewController,
    ProgramAuthoringController,
    ProgramCoverController,
    ProgramsController,
    ProgramLifecycleController,
    StudentDashboardController,
    ProgramEditorController,
    MilestonesController,
    ProgramTeamsController,
    BoardController,
    TeamInvitationsController,
    ProgramOverviewController,
    PublicProjectsController,
    PublicUserProfileController,
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
    BoardService,
    BoardRepository,
    TeamInvitationsService,
    TeamInvitationsRepository,
    ProgramOverviewService,
    ProgramOverviewRepository,
    PublicEligibilityRepository,
    PublicEligibilityService,
    PublicProjectsRepository,
    PublicProjectMetricsRepository,
    PublicProjectsService,
  ],
  exports: [
    ProgramActivitySummaryService,
    ProgramAuthoringService,
    ProgramAuthoringUploadService,
    ProgramAuthoringUploadMaintenanceService,
    BoardService,
    TeamInvitationsService,
    ProgramOverviewService,
    PublicEligibilityService,
    PublicProjectsService,
  ],
})
export class ProgramsModule {}
