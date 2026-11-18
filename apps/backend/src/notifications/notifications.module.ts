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
import { ProgramMailController } from './program-mail.controller';
import { ProgramMailDeliveryService } from './program-mail-delivery.service';
import { ProgramMailRepository } from './program-mail.repository';
import { ProgramMailService } from './program-mail.service';
import { ProgramMailTemplateService } from './program-mail-template.service';

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
    ProgramMailRepository,
    ProgramMailDeliveryService,
    ProgramMailService,
    ProgramMailTemplateService,
    mailSenderProvider,
  ],
  exports: [DeadlineDigestService],
})
export class NotificationsModule {}
