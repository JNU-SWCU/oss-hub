import { MailJobsService } from './mail-jobs.service';
import { MailJobAdmissionRepository } from './mail-job-admission.repository';
import { MailJobResultRepository } from './mail-job-result.repository';
import { Module } from '@nestjs/common';
import { MailJobsController } from './mail-jobs.controller';
import { MailPreviewService } from './mail-preview.service';
import { DeadlineDigestController } from './deadline-digest.controller';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import { DeadlineDigestService } from './deadline-digest.service';
import { DeadlineDigestMailService } from './deadline-digest-mail.service';
import { NotificationSettingsController } from './notification-settings.controller';
import {
  NotificationSettingsRepository,
  ApplicationDecisionNotificationsRepository,
} from './application-decision-notifications.repository';
import {
  NotificationSettingsService,
  ApplicationDecisionNotificationsService,
} from './application-decision-notifications.service';
import { ApplicationDecisionNotificationsController } from './application-decision-notifications.controller';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import { ProgramMailBatchPayloadRepository } from './program-mail-batch-payload.repository';
import { ProgramMailController } from './program-mail.controller';
import { ProgramMailRepository } from './program-mail.repository';
import { ProgramMailJobRepository } from './program-mail-job.repository';
import { ProgramMailService } from './program-mail.service';
import { ProgramMailTemplateService } from './program-mail-template.service';

@Module({
  controllers: [
    MailJobsController,
    ApplicationDecisionNotificationsController,
    NotificationSettingsController,
    DeadlineDigestController,
    ProgramMailController,
  ],
  providers: [
    MailPreviewService,
    MailJobsService,
    MailJobAdmissionRepository,
    MailJobResultRepository,
    ApplicationDecisionNotificationsRepository,
    ApplicationDecisionNotificationsService,
    NotificationSettingsRepository,
    NotificationSettingsService,
    DeadlineDigestRepository,
    DeadlineDigestService,
    DeadlineDigestMailService,
    ProgramMailAuditRepository,
    ProgramMailBatchPayloadRepository,
    ProgramMailRepository,
    ProgramMailJobRepository,
    ProgramMailService,
    ProgramMailTemplateService,
  ],
  exports: [DeadlineDigestService],
})
export class NotificationsModule {}
