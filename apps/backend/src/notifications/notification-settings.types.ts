export interface NotificationSettings {
  readonly notificationEmail: string | null;
  readonly notifyEnabled: boolean;
}

export interface UpdateNotificationEmailInput {
  readonly notificationEmail: string;
  readonly notifyEnabled: boolean;
}
