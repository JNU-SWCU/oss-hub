import { DEPARTMENT_OPTIONS, OTHER_DEPARTMENT } from './departments';
import type {
  CompleteProfileRequest,
  ProfileFormErrors,
  ProfileFormValues,
  UserProfile,
} from './types';

export const PROFILE_ONBOARDING_NEXT_PATH = '/onboarding/role';
export const PROFILE_NAME_MAX_LENGTH = 100;
export const PROFILE_DEPARTMENT_MAX_LENGTH = 100;

export function getProfileRedirect(profile: UserProfile): string | null {
  return profile.isComplete ? PROFILE_ONBOARDING_NEXT_PATH : null;
}

export function createInitialProfileForm(
  profile: UserProfile,
): ProfileFormValues {
  const department = profile.department ?? '';
  const isListed = DEPARTMENT_OPTIONS.includes(department);
  return {
    name: profile.name,
    studentId: profile.studentId ?? '',
    departmentOption: isListed
      ? department
      : department
        ? OTHER_DEPARTMENT
        : '',
    otherDepartment: isListed ? '' : department,
  };
}

export function resolveDepartment(values: ProfileFormValues): string {
  return values.departmentOption === OTHER_DEPARTMENT
    ? values.otherDepartment.trim()
    : values.departmentOption;
}

export function validateProfileForm(
  values: ProfileFormValues,
): ProfileFormErrors {
  const name = values.name.trim();
  const studentId = values.studentId.trim();
  const department = resolveDepartment(values);
  return {
    name: !name
      ? '이름을 입력해 주세요.'
      : name.length > PROFILE_NAME_MAX_LENGTH
        ? `이름은 ${PROFILE_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`
        : null,
    studentId: /^\d{6,10}$/.test(studentId)
      ? null
      : '학번은 숫자 6~10자리로 입력해 주세요.',
    department: !department
      ? '학과를 선택하거나 입력해 주세요.'
      : department.length > PROFILE_DEPARTMENT_MAX_LENGTH
        ? `학과는 ${PROFILE_DEPARTMENT_MAX_LENGTH}자 이하로 입력해 주세요.`
        : null,
  };
}

export function isProfileFormValid(errors: ProfileFormErrors): boolean {
  return Object.values(errors).every((error) => error === null);
}

export function toCompleteProfileRequest(
  values: ProfileFormValues,
): CompleteProfileRequest | null {
  const errors = validateProfileForm(values);
  if (!isProfileFormValid(errors)) {
    return null;
  }
  return {
    name: values.name.trim(),
    studentId: values.studentId.trim(),
    department: resolveDepartment(values),
  };
}
