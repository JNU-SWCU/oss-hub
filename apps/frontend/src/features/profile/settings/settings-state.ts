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

/**
 * 알림 설정을 **불러오지** 못했을 때의 안내.
 * 원인 + 프로필 편집은 계속 된다는 사실 + 다음 행동(다시 불러오기 / 문의)을 함께 적는다.
 * 문구가 가리키는 "다시 불러오기"는 이 Alert 안의 버튼이다 — 전체 새로고침을 요구하지 않는다.
 */
export function notificationUnavailableMessage(
  kind: 'forbidden' | 'not-found' | 'generic',
): string {
  switch (kind) {
    case 'forbidden':
      return '이 계정에는 알림 설정 권한이 없습니다. 프로필은 그대로 수정·저장할 수 있고, 알림 수신이 필요하면 사업단 관리자에게 문의해 주세요.';
    case 'not-found':
      return '아직 만들어진 알림 설정이 없습니다. 프로필은 그대로 수정·저장할 수 있고, 아래 다시 불러오기를 눌러도 같은 안내가 나오면 사업단 관리자에게 문의해 주세요.';
    case 'generic':
      return '알림 설정을 불러오지 못했습니다. 프로필은 그대로 수정·저장할 수 있고, 알림 설정만 아래 다시 불러오기로 다시 시도할 수 있습니다.';
  }
}

/**
 * 프로필은 저장됐지만 알림 설정 **저장**이 실패했을 때의 안내.
 * 프로필 저장 성공 · 알림이 남은 값 · 입력값 보존 · 다음 행동을 한 문장씩 적는다.
 * 입력한 알림 값은 화면에 그대로 남으므로(설정 화면은 실패 시 폼을 되돌리지 않는다)
 * 사용자는 다시 입력하지 않고 저장만 다시 누르면 된다.
 */
export function notificationSaveFailureMessage(
  kind: 'forbidden' | 'not-found' | 'generic',
): string {
  switch (kind) {
    case 'forbidden':
      return '프로필은 저장했습니다. 이 계정에는 알림 설정 변경 권한이 없어 알림 설정은 이전 값으로 그대로 남아 있습니다. 변경이 필요하면 사업단 관리자에게 문의해 주세요.';
    case 'not-found':
    case 'generic':
      return '프로필은 저장했습니다. 알림 설정은 저장되지 않아 이전 값으로 남아 있습니다. 입력한 값은 화면에 그대로 두었으니 잠시 후 저장을 다시 눌러 주세요.';
  }
}

export type { SettingsNotificationLoadState };
