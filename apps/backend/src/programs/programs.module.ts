import { StudentRepositoryUrlContextRepository } from './student-repository-url-context.repository';
import { ProgramListStatusFilterRepository } from './program-list-status-filter.repository';
import { ProgramAuthoringUploadTransactionRepository } from './program-authoring-upload-transaction.repository';
import { MilestoneDocumentSubmissionRepository } from './milestone-document-submission.repository';
import { ProgramDeletionScopeRepository } from './program-deletion-scope.repository';
import { TeamDeletionScopeRepository } from './team-deletion-scope.repository';
import { ReviewHistoryWriterRepository } from './review-history-writer.repository';
import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import { ProgramsController } from './programs.controller';
import { PlatformModule } from '../platform/platform.module';
import { Module } from '@nestjs/common';
import { HttpSecurityModule } from '../platform/http-security.module';
import { GithubModule } from '../github/github.module';
import { UsersModule } from '../users/users.module';
import { ProgramAuthoringController } from './program-authoring.controller';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import {
  ProgramAuthoringService,
  ProgramNoticePreviewService,
} from './program-authoring.service';
import { ProgramAuthoringUploadMaintenanceService } from './program-authoring-upload-maintenance.service';
import { ProgramPurgeFileCleanupService } from './program-purge-file-cleanup.service';
import { ProgramPurgeFileCleanupRepository } from './program-purge-file-cleanup.repository';
import { ProgramAuthoringUploadRepository } from './program-authoring-upload.repository';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import { ApplicationTemplatesController } from './application-templates.controller';
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
import { ProgramLifecycleRepository } from './program-lifecycle.repository';
import { ProgramLifecycleService } from './program-lifecycle.service';
import { ProgramTeamsController } from './program-teams.controller';
import { ProgramTeamDeletionRepository } from './program-team-deletion.repository';
import { ProgramTeamsRepository } from './program-teams.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { ProgramTeamsService } from './program-teams.service';
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
import { AuditLogService } from '../platform/audit-log.service';
import { ApplicationPreparationsController } from './application-preparations.controller';
import {
  ApplicationPreparationsService,
  ApplicationJoinCodeService,
} from './application-preparations.service';
import { ApplicationPreparationsRepository } from './application-preparations.repository';
import { ApplicationsController } from './applications.controller';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationsService } from './applications.service';
import { ProgramApplicationsController } from './program-applications.controller';
import { StudentApplicationManagementRepository } from './student-application-management.repository';
import { STUDENT_APPLICATION_MANAGEMENT_CLOCK } from './student-application-management.config';
import { StudentApplicationManagementService } from './student-application-management.service';
import { StudentApplicationsController } from './student-applications.controller';
import { StudentRepositoryUrlController } from './student-repository-url.controller';
import { StudentRepositoryUrlService } from './student-repository-url.service';
import { StudentRepositoryUrlRepository } from './student-repository-url-transaction.repository';
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
import { SubmissionFormsController } from './submission-forms.controller';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';
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
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { ApplicationAnswersService } from './application-answers.service';
import { DownloadResponseService } from './download-response.service';
import { MilestoneCompletionService } from './milestone-completion.service';
import { MilestoneDocumentRulesService } from './milestone-document-rules.service';
import { ProgramCoverUrlService } from './program-cover-url.service';
import { ProgramRulesService } from './program-rules.service';
import { ProgramUploadRulesService } from './program-upload-rules.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';
import { SubmissionInputService } from './submission-input.service';
import { RepositoryUrlService } from '../github/repository-url.service';

@Module({
  imports: [PlatformModule, HttpSecurityModule, GithubModule, UsersModule],
  controllers: [
    ApplicationPreparationsController,
    StudentRepositoryUrlController,
    StudentApplicationsController,
    ProgramApplicationsController,
    ApplicationsController,
    ApplicationTemplatesController,
    ProgramAuthoringController,
    ProgramsController,
    MilestonesController,
    ProgramTeamsController,
    BoardController,
    TeamInvitationsController,
    ProgramOverviewController,
    PublicProjectsController,
    PublicUserProfileController,
    SubmissionFilesController,
    ProgramSubmissionsController,
    SubmissionFormsController,
    SubmissionsController,
    SubmissionRepositoryPublishingController,
    ProgramDocumentArchivesController,
    ProgramDocumentChangeRequestsController,
    MilestoneDocumentsController,
    MilestoneDocumentFilesController,
  ],
  providers: [
    SubmissionsRepository,
    SubmissionReviewsRepository,
    SubmissionMatrixRepository,
    MilestoneDocumentCollectionReadRepository,
    StudentRepositoryUrlContextRepository,
    ProgramListStatusFilterRepository,
    ProgramAuthoringUploadTransactionRepository,
    MilestoneDocumentSubmissionRepository,
    ProgramCoverUrlService,
    ApplicationAnswersService,
    DownloadResponseService,
    MilestoneCompletionService,
    MilestoneDocumentRulesService,
    ProgramRulesService,
    ProgramUploadRulesService,
    SubmissionFileRulesService,
    SubmissionInputService,
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
    ProgramTeamsService,
    ProgramTeamsRepository,
    ProgramTeamRepositoryEvidenceRepository,
    ProgramTeamDeletionRepository,
    TeamDeletionScopeRepository,
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
        ApplicationJoinCodeService,
        AuditLogMetadataService,
        RepositoryUrlService,
        ApplicationAnswersService,
        RepositoryProvisionEventService,
      ],
      useFactory: (
        repository: ApplicationsRepository,
        auditLog: AuditLogService,
        joinCodes: ApplicationJoinCodeService,
        auditLogMetadata: AuditLogMetadataService,
        repositoryUrl: RepositoryUrlService,
        answers: ApplicationAnswersService,
        repositoryProvisionEvents: RepositoryProvisionEventService,
      ): ApplicationsService =>
        new ApplicationsService(
          repository,
          auditLog,
          joinCodes,
          auditLogMetadata,
          repositoryUrl,
          answers,
          repositoryProvisionEvents,
        ),
    },
    StudentApplicationManagementRepository,
    ReviewHistoryWriterRepository,
    StudentApplicationManagementService,
    {
      provide: STUDENT_APPLICATION_MANAGEMENT_CLOCK,
      useValue: () => new Date(),
    },
    SubmissionsRepository,
    SubmissionFilesRepository,
    SubmissionFilesService,
    SubmissionFileCleanupService,
    SubmissionFileCleanupRetryService,
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
    MilestoneDocumentFilesService,
    MilestoneDocumentReviewsService,
    ProgramDocumentChangeRequestsService,
    MilestoneDocumentArchiveService,
    MilestoneDocumentArchiveRepository,
  ],
  exports: [
    MilestoneCompletionService,
    MilestoneDocumentRulesService,
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
