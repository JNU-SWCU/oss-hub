import { AuditLogMetadataService } from '../src/platform/audit-log-metadata.service';
import { UserProfileService } from '../src/platform/user-profile.service';
import { JoinCodeSecretService } from '../src/platform/join-code-secret.service';
import { RepositoryUrlService } from '../src/github/repository-url.service';
import { RepositoryProvisionEventService } from '../src/github/repository-provision-event.service';
import { RepositoryPublishService } from '../src/github/repository-publish.service';
import { RepositoryProvisionRulesService } from '../src/github/repository-provision-rules.service';
import { AuthSessionService } from '../src/auth/auth-session.service';
import { ApplicationAnswersService } from '../src/programs/application-answers.service';
import { DownloadResponseService } from '../src/programs/download-response.service';
import { MilestoneCompletionService } from '../src/programs/milestone-completion.service';
import { MilestoneDocumentRulesService } from '../src/programs/milestone-document-rules.service';
import { ProgramCoverUrlService } from '../src/programs/program-cover-url.service';
import { ProgramRulesService } from '../src/programs/program-rules.service';
import { ProgramUploadRulesService } from '../src/programs/program-upload-rules.service';
import { SubmissionFileRulesService } from '../src/programs/submission-file-rules.service';
import { SubmissionInputService } from '../src/programs/submission-input.service';
import { RankingYearService } from '../src/ranking/ranking-year.service';
import { StaffInsightsQueryService } from '../src/staff/staff-insights-query.service';
import { AdminAccessMutationService } from '../src/users/admin-access-mutation.service';
import { AdminProfileMutationService } from '../src/users/admin-profile-mutation.service';

export const STATELESS_PROVIDERS = [
  AuditLogMetadataService,
  UserProfileService,
  JoinCodeSecretService,
  RepositoryUrlService,
  RepositoryProvisionEventService,
  RepositoryPublishService,
  RepositoryProvisionRulesService,
  AuthSessionService,
  ApplicationAnswersService,
  DownloadResponseService,
  MilestoneCompletionService,
  MilestoneDocumentRulesService,
  ProgramCoverUrlService,
  ProgramRulesService,
  ProgramUploadRulesService,
  SubmissionFileRulesService,
  SubmissionInputService,
  RankingYearService,
  StaffInsightsQueryService,
  AdminAccessMutationService,
  AdminProfileMutationService,
];
