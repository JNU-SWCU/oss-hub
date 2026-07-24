import type { NotificationSettings } from '../notification-settings.repository';

export class NotificationSettingsResponseDto {
  private constructor(
    readonly notificationEmail: string | null,
    readonly notifyEnabled: boolean,
  ) {}

  static from(settings: NotificationSettings): NotificationSettingsResponseDto {
    return new NotificationSettingsResponseDto(
      settings.notificationEmail,
      settings.notifyEnabled,
    );
  }
}
