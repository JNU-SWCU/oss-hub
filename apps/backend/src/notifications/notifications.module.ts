import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeadlineDigestFailuresController } from './deadline-digest-failures.controller';
import { DeadlineDigestController } from './deadline-digest.controller';
import { DeadlineDigestFailuresService } from './deadline-digest-failures.service';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import { DeadlineDigestScheduler } from './deadline-digest.scheduler';
import { DeadlineDigestService } from './deadline-digest.service';
import { mailSenderProvider } from './mail-sender.provider';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsRepository } from './notification-settings.repository';
import { NotificationSettingsService } from './notification-settings.service';
import { ApplicationDecisionNotificationsController } from './application-decision-notifications.controller';
import { ApplicationDecisionNotificationsRepository } from './application-decision-notifications.repository';
import { ApplicationDecisionNotificationsService } from './application-decision-notifications.service';

@Module({
  imports: [AuthModule],
  controllers: [
    ApplicationDecisionNotificationsController,
    NotificationSettingsController,
    DeadlineDigestFailuresController,
    DeadlineDigestController,
  ],
  providers: [
    ApplicationDecisionNotificationsRepository,
    ApplicationDecisionNotificationsService,
    NotificationSettingsRepository,
    NotificationSettingsService,
    DeadlineDigestRepository,
    DeadlineDigestService,
    DeadlineDigestFailuresService,
    DeadlineDigestScheduler,
    mailSenderProvider,
  ],
  exports: [DeadlineDigestService],
})
export class NotificationsModule {}
