import {
  normalizeProfileText,
  type ProfileRole,
} from '../profile-requirements';
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
const STAFF_NUMBER_MAX_LENGTH = 100;

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
    staffNumber: profile.staffNumber ?? '',
    phone: seed.phone,
    departmentOption: seed.departmentOption,
    otherDepartment: seed.otherDepartment,
    notificationEmail: notification?.notificationEmail ?? '',
    notifyEnabled: notification?.notifyEnabled ?? false,
  };
}

export function validateSettingsForm(
  values: SettingsFormValues,
  notificationAvailable: boolean,
  memberKind: ProfileRole | null,
): SettingsFormErrors {
  const profileErrors = validateSettingsProfileForm(values, memberKind);
  return {
    name: profileErrors.name,
    studentId: profileErrors.studentId,
    staffNumber: staffNumberError(values.staffNumber, memberKind),
    phone: profileErrors.phone,
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
  memberKind: ProfileRole | null,
) {
  const request = toUpdateProfileRequest(values, memberKind);
  if (!request || staffNumberError(values.staffNumber, memberKind) !== null) {
    return null;
  }
  if (memberKind !== 'STAFF') {
    return request;
  }
  const staffNumber = normalizeProfileText(values.staffNumber);
  return {
    ...request,
    staffNumber: staffNumber.length > 0 ? staffNumber : null,
  };
}

function staffNumberError(
  staffNumber: string,
  memberKind: ProfileRole | null,
): string | null {
  if (memberKind !== 'STAFF') {
    return null;
  }
  const normalized = normalizeProfileText(staffNumber);
  return Array.from(normalized).length > STAFF_NUMBER_MAX_LENGTH
    ? `교직원 번호는 ${STAFF_NUMBER_MAX_LENGTH}자 이하로 입력해 주세요.`
    : null;
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
      return '이 계정에는 알림 설정 권한이 없습니다. 프로필은 그대로 수정·저장할 수 있고, 알림 수신이 필요하면 사업단 관리자에게 문의해 주세요.';
    case 'not-found':
      return '아직 만들어진 알림 설정이 없습니다. 프로필은 그대로 수정·저장할 수 있고, 아래 다시 불러오기를 눌러도 같은 안내가 나오면 사업단 관리자에게 문의해 주세요.';
    case 'generic':
      return '알림 설정을 불러오지 못했습니다. 프로필은 그대로 수정·저장할 수 있고, 알림 설정만 아래 다시 불러오기로 다시 시도할 수 있습니다.';
  }
}

export function notificationSaveFailureMessage(
  kind: 'forbidden' | 'not-found' | 'generic',
): string {
  switch (kind) {
    case 'forbidden':
      return '프로필은 저장했습니다. 알림 설정은 변경 권한이 없어 이전 값으로 유지됩니다. 변경이 필요하면 사업단 관리자에게 문의해 주세요.';

    case 'not-found':
      return '프로필은 저장했습니다. 알림 설정을 저장할 계정을 찾지 못했습니다. 입력값은 화면에 남아 있습니다. 다시 로그인해 확인하고, 같은 안내가 반복되면 사업단 관리자에게 문의해 주세요.';

    case 'generic':
      return '프로필은 저장했습니다. 알림 설정의 저장 여부는 확인하지 못했습니다. 입력값은 화면에 남아 있으니 저장을 다시 눌러 주세요. 같은 안내가 반복되면 설정 화면을 새로 열어 저장된 값을 확인해 주세요.';
  }
}

export type { SettingsNotificationLoadState };
