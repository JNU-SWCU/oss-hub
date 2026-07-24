import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import { DeadlineDigestScheduler } from './deadline-digest.scheduler';
import { DeadlineDigestService } from './deadline-digest.service';
import { mailSenderProvider } from './mail-sender.provider';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsRepository } from './notification-settings.repository';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsStaffGuard } from './notifications-staff.guard';

@Module({
  imports: [AuthModule, ScheduleModule.forRoot()],
  controllers: [NotificationSettingsController],
  providers: [
    NotificationsStaffGuard,
    NotificationSettingsRepository,
    NotificationSettingsService,
    DeadlineDigestRepository,
    DeadlineDigestService,
    DeadlineDigestScheduler,
    mailSenderProvider,
  ],
})
export class NotificationsModule {}
