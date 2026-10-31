import type { NotificationSettings } from '../application-decision-notifications.repository';

export class NotificationSettingsResponseDto {
  declare readonly notificationEmail: string | null;
  declare readonly notifyEnabled: boolean;

  static from(settings: NotificationSettings): NotificationSettingsResponseDto {
    return {
      notificationEmail: settings.notificationEmail,
      notifyEnabled: settings.notifyEnabled,
    };
  }
}
