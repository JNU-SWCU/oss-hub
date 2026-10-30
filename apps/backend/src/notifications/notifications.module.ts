import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeadlineDigestController } from './deadline-digest.controller';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import {
  DeadlineDigestScheduler,
  DeadlineDigestService,
  mailSenderProvider,
} from './deadline-digest.service';
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
  imports: [AuthModule],
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
    DeadlineDigestScheduler,
    mailSenderProvider,
  ],
  exports: [DeadlineDigestService],
})
export class NotificationsModule {}
