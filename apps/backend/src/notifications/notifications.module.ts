import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeadlineDigestFailuresController } from './deadline-digest-failures.controller';
import { DeadlineDigestFailuresService } from './deadline-digest-failures.service';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import { DeadlineDigestScheduler } from './deadline-digest.scheduler';
import { DeadlineDigestService } from './deadline-digest.service';
import { mailSenderProvider } from './mail-sender.provider';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsRepository } from './notification-settings.repository';
import { NotificationSettingsService } from './notification-settings.service';

/**
 * ScheduleModule.forRoot()는 CollectionModule이 담당한다 — 여기서 재등록하지 않는다.
 * Cron provider(DeadlineDigestScheduler)는 AppModule이 Collection 이후 Notifications를 로드하면 동작한다.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    NotificationSettingsController,
    DeadlineDigestFailuresController,
  ],
  providers: [
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
