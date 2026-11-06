import {
  FileMetadataRepository,
  ProgramAuthoringUploadTransactionRepository,
} from '../src/programs/files.repository';
import { PlatformRepository } from '../src/platform/platform.repository';
import { PrismaSerializationRetryRepository } from '../src/platform/prisma-serialization-retry.repository';
import { RepositoryProvisionGenerationRepository } from '../src/platform/repository-provision-generation.repository';
import { SubmissionsRepository } from '../src/programs/submissions.repository';
import { ProgramListStatusFilterRepository } from '../src/programs/programs.repository';
import { StudentRepositoryUrlContextRepository } from '../src/programs/team.repository';
import { AdminAccessHistoryRepository } from '../src/users/admin-access-history.repository';
import { AdminAccessReadOrderingRepository } from '../src/users/admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from '../src/users/admin-access-read.repository';
import { ProgramNoticeFetchClient } from '../src/programs/program-notice-fetch.client';
import { HistoryMetadataService } from '../src/platform/history-metadata.service';
import { UserProfileService } from '../src/users/user-profile.service';
import { RepositoryUrlService } from '../src/github/repository-url.service';
import { RepositoryProvisionEventService } from '../src/github/repository-provision-event.service';
import { RepositoryPublishService } from '../src/github/repository-publish.service';
import { AuthSessionService } from '../src/platform/auth-session.service';
import {
  ApplicationAnswersService,
  ProgramTemplatesService,
} from '../src/programs/team-application.service';
import { DownloadResponseService } from '../src/programs/download-response.service';
import { MilestoneCompletionService } from '../src/programs/submissions.service';
import {
  MilestoneDocumentFileNameService,
  MilestoneDocumentSubmissionWindowService,
  SubmissionFileAdmissionService,
} from '../src/programs/files.service';
import { ProgramCoverUrlService } from '../src/programs/programs.service';
import { ProgramScheduleService } from '../src/programs/program-schedule.service';
import { RankingYearService } from '../src/ranking/ranking-year.service';
import { StaffInsightsQueryService } from '../src/staff/staff-insights-query.service';
import { AdminAccessMutationService } from '../src/users/admin-access-mutation.service';
import { AdminProfileMutationService } from '../src/users/admin-profile-mutation.service';

export const STATELESS_PROVIDERS = [
  FileMetadataRepository,
  PlatformRepository,
  PrismaSerializationRetryRepository,
  RepositoryProvisionGenerationRepository,
  ProgramAuthoringUploadTransactionRepository,
  SubmissionsRepository,
  ProgramListStatusFilterRepository,
  StudentRepositoryUrlContextRepository,
  AdminAccessHistoryRepository,
  AdminAccessReadOrderingRepository,
  AdminAccessReadRepository,
  ProgramNoticeFetchClient,
  HistoryMetadataService,
  UserProfileService,
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
  RankingYearService,
  StaffInsightsQueryService,
  AdminAccessMutationService,
  AdminProfileMutationService,
];
