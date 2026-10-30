import type { NotificationSettings } from '../notifications.types';

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
