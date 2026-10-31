import type { NotificationSettings } from '../notifications.types';

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
