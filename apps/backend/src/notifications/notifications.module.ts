import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeadlineDigestController } from './controller/deadline-digest.controller';
import { DeadlineDigestRepository } from './repository/deadline-digest.repository';
import { DeadlineDigestScheduler } from './job/deadline-digest.scheduler';
import { DeadlineDigestService } from './service/deadline-digest.service';
import { mailSenderProvider } from './service/mail-sender.provider';
import { NotificationSettingsController } from './controller/notification-settings.controller';
import { NotificationSettingsRepository } from './repository/notification-settings.repository';
import { NotificationSettingsService } from './service/notification-settings.service';
import { ApplicationDecisionNotificationsController } from './controller/application-decision-notifications.controller';
import { ApplicationDecisionNotificationsRepository } from './repository/application-decision-notifications.repository';
import { ApplicationDecisionNotificationsService } from './service/application-decision-notifications.service';

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
