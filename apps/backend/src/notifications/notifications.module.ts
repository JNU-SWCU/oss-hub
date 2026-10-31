import { Module } from '@nestjs/common';
import { HttpSecurityModule } from '../platform/http-security.module';
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

@Module({
  imports: [HttpSecurityModule],
  controllers: [
    ApplicationDecisionNotificationsController,
    NotificationSettingsController,
    DeadlineDigestController,
  ],
  providers: [
    ApplicationDecisionNotificationsRepository,
    ApplicationDecisionNotificationsService,
    NotificationSettingsRepository,
    NotificationSettingsService,
    DeadlineDigestRepository,
    DeadlineDigestService,
    DeadlineDigestMailService,
    mailSenderProvider,
  ],
  exports: [DeadlineDigestService],
})
export class NotificationsModule {}
