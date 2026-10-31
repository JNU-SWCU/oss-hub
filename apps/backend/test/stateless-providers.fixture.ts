import { PlatformRepository } from '../src/platform/platform.repository';
import { PrismaSerializationRetryRepository } from '../src/platform/prisma-serialization-retry.repository';
import { RepositoryProvisionGenerationRepository } from '../src/platform/repository-provision-generation.repository';
import { ProgramAuthoringUploadTransactionRepository } from '../src/programs/program-authoring-upload-transaction.repository';
import { MilestoneDocumentSubmissionRepository } from '../src/programs/milestone-document-submission.repository';
import { ProgramListStatusFilterRepository } from '../src/programs/program-list-status-filter.repository';
import { StudentRepositoryUrlContextRepository } from '../src/programs/student-repository-url-context.repository';
import { AdminAccessHistoryRepository } from '../src/users/admin-access-history.repository';
import { AdminAccessReadOrderingRepository } from '../src/users/admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from '../src/users/admin-access-read.repository';
import { ProgramNoticeFetchClient } from '../src/programs/program-notice-fetch.client';
import { AuditLogMetadataService } from '../src/platform/audit-log-metadata.service';
import { UserProfileService } from '../src/users/user-profile.service';
import { JoinCodeSecretService } from '../src/platform/join-code-secret.service';
import { RepositoryUrlService } from '../src/github/repository-url.service';
import { RepositoryProvisionEventService } from '../src/github/repository-provision-event.service';
import { RepositoryPublishService } from '../src/github/repository-publish.service';
import { AuthSessionService } from '../src/platform/auth-session.service';
import { ApplicationAnswersService } from '../src/programs/application-answers.service';
import { DownloadResponseService } from '../src/programs/download-response.service';
import { MilestoneCompletionService } from '../src/programs/milestone-completion.service';
import { MilestoneDocumentFileNameService } from '../src/programs/milestone-document-file-name.service';
import { MilestoneDocumentSubmissionWindowService } from '../src/programs/milestone-document-submission-window.service';
import { ProgramCoverUrlService } from '../src/programs/program-cover-url.service';
import { ProgramScheduleService } from '../src/programs/program-schedule.service';
import { ProgramTemplatesService } from '../src/programs/program-templates.service';
import { SubmissionFileAdmissionService } from '../src/programs/submission-file-admission.service';
import { SubmissionInputService } from '../src/programs/submission-input.service';
import { RankingYearService } from '../src/ranking/ranking-year.service';
import { StaffInsightsQueryService } from '../src/staff/staff-insights-query.service';
import { AdminAccessMutationService } from '../src/users/admin-access-mutation.service';
import { AdminProfileMutationService } from '../src/users/admin-profile-mutation.service';

export const STATELESS_PROVIDERS = [
  PlatformRepository,
  PrismaSerializationRetryRepository,
  RepositoryProvisionGenerationRepository,
  ProgramAuthoringUploadTransactionRepository,
  MilestoneDocumentSubmissionRepository,
  ProgramListStatusFilterRepository,
  StudentRepositoryUrlContextRepository,
  AdminAccessHistoryRepository,
  AdminAccessReadOrderingRepository,
  AdminAccessReadRepository,
  ProgramNoticeFetchClient,
  AuditLogMetadataService,
  UserProfileService,
  JoinCodeSecretService,
  RepositoryUrlService,
  RepositoryProvisionEventService,
  RepositoryPublishService,
  AuthSessionService,
  ApplicationAnswersService,
  DownloadResponseService,
  MilestoneCompletionService,
  MilestoneDocumentFileNameService,
  MilestoneDocumentSubmissionWindowService,
  ProgramCoverUrlService,
  ProgramScheduleService,
  ProgramTemplatesService,
  SubmissionFileAdmissionService,
  SubmissionInputService,
  RankingYearService,
  StaffInsightsQueryService,
  AdminAccessMutationService,
  AdminProfileMutationService,
];
