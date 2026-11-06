import {
  FileMetadataRepository,
  ProgramAuthoringUploadTransactionRepository,
  FileCleanupRepository,
  ProgramAuthoringUploadRepository,
  ProgramCoverRepository,
  FilesRepository,
} from './files.repository';
import {
  StudentRepositoryUrlContextRepository,
  TeamDeletionScopeRepository,
  ProgramTeamDeletionRepository,
  TeamRepository,
  ApplicationsRepository,
  StudentApplicationManagementRepository,
  StudentRepositoryUrlRepository,
} from './team.repository';
import {
  ProgramListStatusFilterRepository,
  ProgramDeletionScopeRepository,
  ProgramAuthoringRepository,
  ProgramLifecycleRepository,
  ProgramsRepository,
  ProgramHistoryRepository,
  ProgramOverviewRepository,
} from './programs.repository';
import {
  SubmissionsRepository,
  SubmissionDashboardSummaryRepository,
  SubmissionMatrixRepository,
  SubmissionReviewsRepository,
} from './submissions.repository';
import { TeamHistoryRepository } from './team-history.repository';
import { ProgramsController } from './programs.controller';
import { PlatformModule } from '../platform/platform.module';
import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { UsersModule } from '../users/users.module';
import { ProgramAuthoringController } from './program-authoring.controller';
import {
  ProgramAuthoringService,
  ProgramNoticePreviewService,
  ProgramLifecycleService,
  ProgramsService,
  ProgramCreationService,
  ProgramCoverService,
  ProgramCoverUrlService,
} from './programs.service';
import {
  FileCleanupService,
  FileCleanupRetryService,
} from './file-cleanup.service';
import {
  ProgramAuthoringUploadService,
  FilesService,
  SubmissionFileAdmissionService,
  RequirementFilesService,
  RequirementFileNameService,
  SubmissionWindowService,
} from './files.service';
import {
  ApplicationTemplatesController,
  TeamsController,
  ApplicationsController,
  ProgramApplicationsController,
  StudentApplicationsController,
  StudentRepositoryUrlController,
} from './teams.controller';
import { MilestonesController } from './milestones.controller';
import {
  ProgramActivityRepository,
  ProgramActivitySummaryRepository,
} from './program-activity.repository';
import { ProgramActivitySummaryService } from './program-activity-summary.service';
import { ProgramActivityService } from './program-activity.service';
import { ProgramEditorRepository } from './program-editor.repository';
import { ProgramEditorService } from './program-editor.service';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { TeamMembershipService } from './team-membership.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { BoardController } from './board.controller';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';
import { ProgramOverviewController } from './program-overview.controller';
import { ProgramOverviewService } from './program-overview.service';
import { PublicEligibilityRepository } from './public-eligibility.repository';
import {
  PublicEligibilityService,
  PublicProjectsService,
} from './public-projects.service';
import { PublicProjectMetricsRepository } from './public-project-metrics.repository';
import { PublicProjectsController } from './public-projects.controller';
import { PublicProjectsRepository } from './public-projects.repository';
import { PublicUserProfileController } from './public-user-profile.controller';
import { TeamInvitationsController } from './team-invitations.controller';
import { TeamInvitationsRepository } from './team-invitations.repository';
import { TeamInvitationsService } from './team-invitations.service';
import {
  TeamApplicationService,
  StudentApplicationManagementService,
  StudentRepositoryUrlService,
  ApplicationAnswersService,
  ProgramTemplatesService,
} from './team-application.service';
import { STUDENT_APPLICATION_MANAGEMENT_CLOCK } from './student-application-management.config';
import {
  SubmissionDashboardSummaryService,
  SubmissionMatrixService,
} from './submission-matrix.service';
import {
  SubmissionsController,
  ProgramSubmissionsController,
  SubmissionRepositoryPublishingController,
} from './submissions.controller';
import {
  FilesController,
  RequirementFilesController,
} from './files.controller';
import {
  SubmissionsService,
  RequirementReviewsService,
  MilestoneCompletionService,
} from './submissions.service';
import {
  RequirementsController,
  ProgramDocumentArchivesController,
  ProgramDocumentChangeRequestsController,
} from './requirements.controller';
import {
  RequirementArchiveRepository,
  RequirementCollectionReadRepository,
  RequirementCurrentFileRepository,
  RequirementsRepository,
} from './requirements.repository';
import {
  ProgramDocumentChangeRequestsService,
  RequirementsService,
} from './requirements.service';
import {
  RequirementArchiveService,
  RequirementCollectionService,
  RequirementCurrentFileService,
} from './requirement-archive.service';
import { DownloadResponseService } from './download-response.service';
import { ProgramScheduleService } from './program-schedule.service';

@Module({
  imports: [PlatformModule, GithubModule, UsersModule],
  controllers: [
    StudentRepositoryUrlController,
    StudentApplicationsController,
    ProgramApplicationsController,
    ApplicationsController,
    ApplicationTemplatesController,
    ProgramAuthoringController,
    ProgramsController,
    MilestonesController,
    TeamsController,
    BoardController,
    TeamInvitationsController,
    ProgramOverviewController,
    PublicProjectsController,
    PublicUserProfileController,
    FilesController,
    ProgramSubmissionsController,
    SubmissionsController,
    SubmissionRepositoryPublishingController,
    ProgramDocumentArchivesController,
    ProgramDocumentChangeRequestsController,
    RequirementsController,
    RequirementFilesController,
  ],
  providers: [
    SubmissionReviewsRepository,
    SubmissionMatrixRepository,
    RequirementCollectionReadRepository,
    StudentRepositoryUrlContextRepository,
    ProgramListStatusFilterRepository,
    ProgramAuthoringUploadTransactionRepository,
    SubmissionsRepository,
    ProgramCoverUrlService,
    ApplicationAnswersService,
    DownloadResponseService,
    MilestoneCompletionService,
    RequirementFileNameService,
    SubmissionWindowService,
    ProgramScheduleService,
    ProgramTemplatesService,
    SubmissionFileAdmissionService,
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
    FileCleanupService,
    FileCleanupRepository,
    ProgramActivityRepository,
    ProgramActivitySummaryRepository,
    ProgramActivitySummaryService,
    ProgramActivityService,
    ProgramViewerService,
    ProgramEditorService,
    ProgramEditorRepository,
    ProgramLifecycleService,
    ProgramLifecycleRepository,
    ProgramDeletionScopeRepository,
    TeamMembershipService,
    TeamRepository,
    ProgramTeamRepositoryEvidenceRepository,
    ProgramTeamDeletionRepository,
    TeamDeletionScopeRepository,
    BoardService,
    BoardRepository,
    TeamInvitationsService,
    TeamInvitationsRepository,
    TeamHistoryRepository,
    ProgramHistoryRepository,
    ProgramOverviewService,
    ProgramOverviewRepository,
    PublicEligibilityRepository,
    PublicEligibilityService,
    PublicProjectsRepository,
    PublicProjectMetricsRepository,
    PublicProjectsService,
    StudentRepositoryUrlService,
    StudentRepositoryUrlRepository,
    ApplicationsRepository,
    TeamApplicationService,
    StudentApplicationManagementRepository,
    StudentApplicationManagementService,
    {
      provide: STUDENT_APPLICATION_MANAGEMENT_CLOCK,
      useValue: () => new Date(),
    },
    FileMetadataRepository,
    FilesRepository,
    FilesService,
    FileCleanupRetryService,
    SubmissionDashboardSummaryRepository,
    SubmissionDashboardSummaryService,
    SubmissionMatrixService,
    SubmissionsService,
    RequirementsService,
    RequirementsRepository,
    RequirementCollectionService,
    RequirementCurrentFileRepository,
    RequirementCurrentFileService,
    RequirementFilesService,
    RequirementReviewsService,
    ProgramDocumentChangeRequestsService,
    RequirementArchiveService,
    RequirementArchiveRepository,
  ],
  exports: [
    MilestoneCompletionService,
    SubmissionWindowService,
    ProgramCoverUrlService,
    ProgramActivityService,
    ProgramViewerService,
    ProgramActivitySummaryService,
    ProgramAuthoringService,
    ProgramAuthoringUploadService,
    FileCleanupService,
    BoardService,
    TeamInvitationsService,
    ProgramOverviewService,
    PublicEligibilityService,
    PublicProjectsService,
    TeamApplicationService,
    SubmissionDashboardSummaryService,
    FilesService,
    RequirementsService,
    RequirementFilesService,
    RequirementCurrentFileService,
  ],
})
export class ProgramsModule {}
