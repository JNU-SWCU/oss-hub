export interface NotificationSettings {
  readonly notificationEmail: string | null;
  readonly notifyEnabled: boolean;
}

export interface UpdateNotificationEmailRequest {
  readonly notificationEmail: string;
  readonly notifyEnabled: boolean;
}
