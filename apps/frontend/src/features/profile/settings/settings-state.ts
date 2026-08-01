import type { ProfileRole } from '../profile-requirements';
import {
  createInitialProfileForm,
  toUpdateProfileRequest,
  validateSettingsProfileForm,
} from '../profile-state';
import type { UserProfile } from '../types';
import type {
  SettingsFormErrors,
  SettingsFormValues,
  SettingsNotificationLoadState,
} from './types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 수신 이메일 형식 검증 — 백엔드 @IsEmail과 같은 계약을 화면에서 선검증한다. */
export function isValidNotificationEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

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
    savedStudentId: profile.studentId ?? '',
    departmentOption: seed.departmentOption,
    otherDepartment: seed.otherDepartment,
    notificationEmail: notification?.notificationEmail ?? '',
    notifyEnabled: notification?.notifyEnabled ?? false,
  };
}

export function validateSettingsForm(
  values: SettingsFormValues,
  notificationAvailable: boolean,
  role: ProfileRole | null,
): SettingsFormErrors {
  const profileErrors = validateSettingsProfileForm(values, role);
  return {
    name: profileErrors.name,
    studentId: profileErrors.studentId,
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

export function toSettingsProfileRequest(
  values: SettingsFormValues,
  role: ProfileRole | null,
) {
  return toUpdateProfileRequest(values, role);
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
