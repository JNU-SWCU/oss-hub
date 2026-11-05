import { StudentRepositoryUrlContextRepository } from './team.repository';
import { ProgramListStatusFilterRepository } from './program-list-status-filter.repository';
import { ProgramAuthoringUploadTransactionRepository } from './program-authoring-upload-transaction.repository';
import { SubmissionsRepository } from './submissions.repository';
import { ProgramDeletionScopeRepository } from './programs.repository';
import { TeamDeletionScopeRepository } from './team.repository';
import { TeamHistoryRepository } from './team-history.repository';
import { ProgramsController } from './programs.controller';
import { PlatformModule } from '../platform/platform.module';
import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { UsersModule } from '../users/users.module';
import { ProgramAuthoringController } from './program-authoring.controller';
import { ProgramAuthoringRepository } from './programs.repository';
import {
  ProgramAuthoringService,
  ProgramNoticePreviewService,
} from './programs.service';
import { ProgramAuthoringUploadMaintenanceService } from './program-authoring-upload-maintenance.service';
import { ProgramPurgeFileCleanupService } from './program-purge-file-cleanup.service';
import { ProgramPurgeFileCleanupRepository } from './program-purge-file-cleanup.repository';
import { ProgramAuthoringUploadRepository } from './program-authoring-upload.repository';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import { ApplicationTemplatesController } from './teams.controller';
import { MilestonesController } from './milestones.controller';
import {
  ProgramCreationService,
  ProgramCoverService,
} from './program-creation.service';
import {
  ProgramActivityRepository,
  ProgramActivitySummaryRepository,
} from './program-activity.repository';
import { ProgramActivitySummaryService } from './program-activity-summary.service';
import { ProgramActivityService } from './program-activity.service';
import { ProgramEditorRepository } from './program-editor.repository';
import { ProgramEditorService } from './program-editor.service';
import { ProgramLifecycleRepository } from './programs.repository';
import { ProgramLifecycleService } from './programs.service';
import { TeamsController } from './teams.controller';
import { ProgramTeamDeletionRepository } from './team.repository';
import { TeamRepository } from './team.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { TeamMembershipService } from './team-membership.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsRepository } from './programs.repository';
import { ProgramsService } from './programs.service';
import { ProgramCoverRepository } from './program-cover.repository';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { BoardController } from './board.controller';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';
import { ProgramOverviewController } from './program-overview.controller';
import { ProgramOverviewRepository } from './program-overview.repository';
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
import { ApplicationsController } from './teams.controller';
import { ApplicationsRepository } from './team.repository';
import { TeamApplicationService } from './team-application.service';
import { ProgramApplicationsController } from './teams.controller';
import { StudentApplicationManagementRepository } from './team.repository';
import { STUDENT_APPLICATION_MANAGEMENT_CLOCK } from './student-application-management.config';
import { StudentApplicationManagementService } from './team-application.service';
import { StudentApplicationsController } from './teams.controller';
import { StudentRepositoryUrlController } from './teams.controller';
import { StudentRepositoryUrlService } from './team-application.service';
import { StudentRepositoryUrlRepository } from './team.repository';
import {
  SubmissionFileCleanupService,
  SubmissionFileCleanupRetryService,
} from './submission-file-cleanup.service';
import { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { SubmissionDashboardSummaryRepository } from './submission-dashboard-summary.repository';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';
import { SubmissionMatrixRepository } from './submission-matrix.repository';
import { SubmissionMatrixService } from './submission-matrix.service';
import { SubmissionsController } from './submissions.controller';
import { ProgramSubmissionsController } from './program-submissions.controller';
import { SubmissionFilesController } from './submission-files.controller';
import { SubmissionRepositoryPublishingController } from './submission-repository-publishing.controller';
import { SubmissionReviewsRepository } from './submission-reviews.repository';
import { SubmissionReviewsService } from './submission-reviews.service';
import { MilestoneDocumentsController } from './milestone-documents.controller';
import { MilestoneDocumentFilesController } from './milestone-document-files.controller';
import { MilestoneDocumentArchiveRepository } from './milestone-document-archive.repository';
import { ProgramDocumentArchivesController } from './program-document-archives.controller';
import { ProgramDocumentChangeRequestsController } from './program-document-change-requests.controller';
import { ProgramDocumentChangeRequestsService } from './program-document-change-requests.service';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import {
  MilestoneDocumentCollectionService,
  MilestoneDocumentCurrentFileService,
} from './milestone-document-collection.service';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import { MilestoneDocumentCurrentFileRepository } from './milestone-document-current-file.repository';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { ApplicationAnswersService } from './team-application.service';
import { DownloadResponseService } from './download-response.service';
import { MilestoneCompletionService } from './milestone-completion.service';
import { MilestoneDocumentFileNameService } from './milestone-document-file-name.service';
import { MilestoneDocumentSubmissionWindowService } from './milestone-document-submission-window.service';
import { ProgramCoverUrlService } from './program-cover-url.service';
import { ProgramScheduleService } from './program-schedule.service';
import { ProgramTemplatesService } from './team-application.service';
import { SubmissionFileAdmissionService } from './submission-file-admission.service';
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
    SubmissionFilesController,
    ProgramSubmissionsController,
    SubmissionsController,
    SubmissionRepositoryPublishingController,
    ProgramDocumentArchivesController,
    ProgramDocumentChangeRequestsController,
    MilestoneDocumentsController,
    MilestoneDocumentFilesController,
  ],
  providers: [
    SubmissionReviewsRepository,
    SubmissionMatrixRepository,
    MilestoneDocumentCollectionReadRepository,
    StudentRepositoryUrlContextRepository,
    ProgramListStatusFilterRepository,
    ProgramAuthoringUploadTransactionRepository,
    SubmissionsRepository,
    ProgramCoverUrlService,
    ApplicationAnswersService,
    DownloadResponseService,
    MilestoneCompletionService,
    MilestoneDocumentFileNameService,
    MilestoneDocumentSubmissionWindowService,
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
    ProgramAuthoringUploadMaintenanceService,
    ProgramPurgeFileCleanupRepository,
    ProgramPurgeFileCleanupService,
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
    SubmissionFilesRepository,
    SubmissionFilesService,
    SubmissionFileCleanupService,
    SubmissionFileCleanupRetryService,
    SubmissionDashboardSummaryRepository,
    SubmissionDashboardSummaryService,
    SubmissionMatrixRepository,
    SubmissionMatrixService,
    SubmissionReviewsRepository,
    SubmissionReviewsService,
    MilestoneDocumentsService,
    MilestoneDocumentsRepository,
    MilestoneDocumentCollectionService,
    MilestoneDocumentCollectionReadRepository,
    MilestoneDocumentCurrentFileRepository,
    MilestoneDocumentCurrentFileService,
    MilestoneDocumentFilesService,
    MilestoneDocumentReviewsService,
    ProgramDocumentChangeRequestsService,
    MilestoneDocumentArchiveService,
    MilestoneDocumentArchiveRepository,
  ],
  exports: [
    MilestoneCompletionService,
    MilestoneDocumentSubmissionWindowService,
    ProgramCoverUrlService,
    ProgramActivityService,
    ProgramViewerService,
    ProgramActivitySummaryService,
    ProgramAuthoringService,
    ProgramAuthoringUploadService,
    ProgramAuthoringUploadMaintenanceService,
    BoardService,
    TeamInvitationsService,
    ProgramOverviewService,
    PublicEligibilityService,
    PublicProjectsService,
    TeamApplicationService,
    SubmissionDashboardSummaryService,
    SubmissionFileCleanupService,
    SubmissionFilesService,
    MilestoneDocumentsService,
    MilestoneDocumentFilesService,
    MilestoneDocumentCurrentFileService,
  ],
})
export class ProgramsModule {}
