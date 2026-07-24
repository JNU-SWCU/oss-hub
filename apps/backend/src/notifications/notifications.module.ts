import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsRepository } from './notification-settings.repository';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsStaffGuard } from './notifications-staff.guard';

@Module({
  imports: [AuthModule],
  controllers: [NotificationSettingsController],
  providers: [
    NotificationsStaffGuard,
    NotificationSettingsRepository,
    NotificationSettingsService,
  ],
})
export class NotificationsModule {}
