import { isValidNotificationEmail } from '@/features/notifications/notification-settings-state';
import {
  createInitialProfileForm,
  toUpdateProfileRequest,
  validateSettingsProfileForm,
} from '@/features/profile/profile-state';
import type { UserProfile } from '@/features/profile/types';
import type {
  SettingsFormErrors,
  SettingsFormValues,
  SettingsNotificationLoadState,
} from './types';

export function createInitialSettingsForm(
  profile: UserProfile,
  notification: {
    readonly notificationEmail: string | null;
    readonly notifyEnabled: boolean;
  } | null,
): SettingsFormValues {
  const seed = createInitialProfileForm(profile);
  return {
    name: seed.name,
    studentId: seed.studentId,
    departmentOption: seed.departmentOption,
    otherDepartment: seed.otherDepartment,
    notificationEmail: notification?.notificationEmail ?? '',
    notifyEnabled: notification?.notifyEnabled ?? false,
  };
}

export function validateSettingsForm(
  values: SettingsFormValues,
  notificationAvailable: boolean,
): SettingsFormErrors {
  const profileErrors = validateSettingsProfileForm(values);
  return {
    name: profileErrors.name,
    department: profileErrors.department,
    notificationEmail:
      notificationAvailable &&
      !isValidNotificationEmail(values.notificationEmail)
        ? '이메일 형식이 올바르지 않습니다.'
        : null,
  };
}

export function isSettingsFormValid(errors: SettingsFormErrors): boolean {
  return Object.values(errors).every((error) => error === null);
}

export function toSettingsProfileRequest(values: SettingsFormValues) {
  return toUpdateProfileRequest(values);
}

export function toSettingsNotificationRequest(values: SettingsFormValues) {
  if (!isValidNotificationEmail(values.notificationEmail)) {
    return null;
  }
  return {
    notificationEmail: values.notificationEmail.trim(),
    notifyEnabled: values.notifyEnabled,
  };
}

export function notificationUnavailableMessage(
  kind: 'forbidden' | 'not-found' | 'generic',
): string {
  switch (kind) {
    case 'forbidden':
      return '알림 설정은 현재 이 계정에서 사용할 수 없습니다.';
    case 'not-found':
      return '알림 설정을 찾을 수 없습니다.';
    case 'generic':
      return '알림 설정을 불러오지 못했습니다. 프로필만 수정할 수 있습니다.';
  }
}

export type { SettingsNotificationLoadState };
