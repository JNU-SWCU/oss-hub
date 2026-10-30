import { ProgramLifecycleController } from './program-lifecycle.controller';
import { PlatformModule } from '../platform/platform.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GithubModule } from '../github/github.module';
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

import { AuditLogService } from '../platform/audit-log.service';
import { UsersAuthorityService } from '../users/authority.service';
import { ApplicationPreparationsController } from './application-preparations.controller';
import { ApplicationPreparationsService } from './application-preparations.service';
import { ApplicationPreparationsRepository } from './application-preparations.repository';
import { ApplicationsController } from './applications.controller';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationJoinCodeService } from './application-join-code.service';
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
import { StudentRepositoryUrlController } from './student-repository-url.controller';
import { StudentRepositoryUrlService } from './student-repository-url.service';
import { StudentRepositoryUrlRepository } from './student-repository-url.repository';
import { SubmissionFileCleanupScheduler } from './submission-file-cleanup.scheduler';
import { SubmissionFileCleanupService } from './submission-file-cleanup.service';
import { SubmissionFileCleanupRetryService } from './submission-file-cleanup-retry.service';
import { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { SubmissionDashboardSummaryRepository } from './submission-dashboard-summary.repository';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';
import { SubmissionMatrixRepository } from './submission-matrix.repository';
import { SubmissionMatrixService } from './submission-matrix.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionChecklistController } from './submission-checklist.controller';
import { SubmissionFilesController } from './submission-files.controller';
import { SubmissionFormsController } from './submission-forms.controller';
import { SubmissionMatrixController } from './submission-matrix.controller';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';
import {
  SubmissionRepositoryPublishingController,
  SubmissionReviewsController,
} from './submission-reviews.controller';
import { SubmissionReviewsRepository } from './submission-reviews.repository';
import { SubmissionReviewsService } from './submission-reviews.service';
import {
  MilestoneDocumentFilesController,
  MilestoneDocumentsController,
} from './milestone-documents.controller';
import { MilestoneDocumentArchiveRepository } from './milestone-document-archive.repository';
import { ProgramDocumentArchivesController } from './program-document-archives.controller';
import { ProgramDocumentChangeRequestsController } from './program-document-change-requests.controller';
import { ProgramDocumentChangeRequestsService } from './program-document-change-requests.service';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { MilestoneDocumentCollectionService } from './milestone-document-collection.service';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import { MilestoneDocumentCurrentFileController } from './milestone-document-current-file.controller';
import { MilestoneDocumentCurrentFileRepository } from './milestone-document-current-file.repository';
import { MilestoneDocumentCurrentFileService } from './milestone-document-current-file.service';
import { MilestoneDocumentFeedbackController } from './milestone-document-feedback.controller';
import { MilestoneDocumentFeedbackRepository } from './milestone-document-feedback.repository';
import {
  MILESTONE_DOCUMENT_FEEDBACK_CLOCK,
  MilestoneDocumentFeedbackService,
} from './milestone-document-feedback.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';

@Module({
  imports: [AuthModule, PlatformModule, GithubModule, UsersModule],
  controllers: [
    ApplicationPreparationsController,
    StudentRepositoryUrlController,
    StaffDashboardController,
    StudentApplicationsController,
    ProgramApplicationsController,
    ApplicationsController,
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
    SubmissionFilesController,
    SubmissionChecklistController,
    SubmissionFormsController,
    SubmissionMatrixController,
    SubmissionsController,
    SubmissionReviewsController,
    SubmissionRepositoryPublishingController,
    ProgramDocumentArchivesController,
    ProgramDocumentChangeRequestsController,
    MilestoneDocumentsController,
    MilestoneDocumentFilesController,
    MilestoneDocumentCurrentFileController,
    MilestoneDocumentFeedbackController,
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
    SubmissionsRepository,
    SubmissionFilesRepository,
    SubmissionFilesService,
    SubmissionFileCleanupService,
    SubmissionFileCleanupRetryService,
    SubmissionFileCleanupScheduler,
    SubmissionsService,
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
    MilestoneDocumentFeedbackRepository,
    MilestoneDocumentFeedbackService,
    { provide: MILESTONE_DOCUMENT_FEEDBACK_CLOCK, useValue: () => new Date() },
    MilestoneDocumentFilesService,
    MilestoneDocumentReviewsService,
    ProgramDocumentChangeRequestsService,
    MilestoneDocumentArchiveService,
    MilestoneDocumentArchiveRepository,
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
    ApplicationsService,
    SubmissionDashboardSummaryService,
    SubmissionFileCleanupService,
    SubmissionFilesService,
    MilestoneDocumentsService,
    MilestoneDocumentFilesService,
    MilestoneDocumentCurrentFileService,
  ],
})
export class ProgramsModule {}
