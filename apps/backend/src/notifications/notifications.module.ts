import { Module } from '@nestjs/common';
import { DeadlineDigestController } from './deadline-digest.controller';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import { DeadlineDigestService } from './deadline-digest.service';
import {
  DeadlineDigestMailService,
  mailSenderProvider,
} from './deadline-digest-mail.service';
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
import { ProgramMailBatchRepository } from './program-mail-batch.repository';
import { ProgramMailController } from './program-mail.controller';
import { ProgramMailDeliveryRepository } from './program-mail-delivery.repository';
import { ProgramMailDeliveryService } from './program-mail-delivery.service';
import { ProgramMailKeyRepository } from './program-mail-key.repository';
import { ProgramMailRepository } from './program-mail.repository';
import { ProgramMailSendRepository } from './program-mail-send.repository';
import { ProgramMailService } from './program-mail.service';
import { ProgramMailTemplateService } from './program-mail-template.service';
import { ProgramMailTransportService } from './program-mail-transport.service';
import { ProgramMailWorkerService } from './program-mail-worker.service';

@Module({
  controllers: [
    ApplicationDecisionNotificationsController,
    NotificationSettingsController,
    DeadlineDigestController,
    ProgramMailController,
  ],
  providers: [
    ApplicationDecisionNotificationsRepository,
    ApplicationDecisionNotificationsService,
    NotificationSettingsRepository,
    NotificationSettingsService,
    DeadlineDigestRepository,
    DeadlineDigestService,
    DeadlineDigestMailService,
    ProgramMailAuditRepository,
    ProgramMailBatchPayloadRepository,
    ProgramMailBatchRepository,
    ProgramMailRepository,
    ProgramMailKeyRepository,
    ProgramMailDeliveryRepository,
    ProgramMailSendRepository,
    ProgramMailTransportService,
    ProgramMailWorkerService,
    ProgramMailDeliveryService,
    ProgramMailService,
    ProgramMailTemplateService,
    mailSenderProvider,
  ],
  exports: [DeadlineDigestService],
})
export class NotificationsModule {}
