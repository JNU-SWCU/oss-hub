export interface SettingsFormValues {
  readonly name: string;
  readonly studentId: string;
  readonly departmentOption: string;
  readonly otherDepartment: string;
  readonly notificationEmail: string;
  readonly notifyEnabled: boolean;
}

export interface SettingsFormErrors {
  readonly name: string | null;
  readonly department: string | null;
  readonly notificationEmail: string | null;
}

export type SettingsNotificationLoadState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'unavailable'; readonly message: string };
