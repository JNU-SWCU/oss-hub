import { DEPARTMENT_OPTIONS, OTHER_DEPARTMENT } from './departments';
import {
  isProfileComplete,
  isValidDepartment,
  isValidProfileName,
  isValidStudentId,
  PROFILE_DEPARTMENT_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  profileFieldRequirement,
  type ProfileRole,
} from './profile-requirements';
import type {
  CompleteProfileRequest,
  ProfileFormErrors,
  ProfileFormValues,
  UpdateProfileRequest,
  UserProfile,
} from './types';

export const PROFILE_ONBOARDING_NEXT_PATH = '/onboarding/role';

// 길이 상한은 profile-requirements가 원본이다. 화면·테스트가 오래 이 경로로
// 가져다 써 왔으므로 여기서도 계속 내보낸다.
export { PROFILE_DEPARTMENT_MAX_LENGTH, PROFILE_NAME_MAX_LENGTH };

export function getProfileRedirect(
  profile: UserProfile,
  role: ProfileRole | null,
): string | null {
  return isProfileComplete(profile, role) ? PROFILE_ONBOARDING_NEXT_PATH : null;
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

export function resolveDepartment(
  values: Pick<ProfileFormValues, 'departmentOption' | 'otherDepartment'>,
): string {
  return values.departmentOption === OTHER_DEPARTMENT
    ? values.otherDepartment.trim()
    : values.departmentOption;
}

function nameError(name: string): string | null {
  if (name.trim().length === 0) {
    return '이름을 입력해 주세요.';
  }
  return isValidProfileName(name)
    ? null
    : `이름은 ${PROFILE_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`;
}

/** 역할이 요구하지 않는 항목은 비어 있어도 통과시키되, 값이 있으면 형식은 계속 본다. */
function studentIdError(studentId: string, required: boolean): string | null {
  if (!required && studentId.length === 0) {
    return null;
  }
  return isValidStudentId(studentId)
    ? null
    : '학번은 숫자 6~10자리로 입력해 주세요.';
}

function departmentError(department: string, required: boolean): string | null {
  if (department.length === 0) {
    return required ? '학과를 선택하거나 입력해 주세요.' : null;
  }
  return isValidDepartment(department)
    ? null
    : `학과는 ${PROFILE_DEPARTMENT_MAX_LENGTH}자 이하로 입력해 주세요.`;
}

export function validateProfileForm(
  values: ProfileFormValues,
  role: ProfileRole | null,
): ProfileFormErrors {
  const requirement = profileFieldRequirement(role);
  return {
    name: nameError(values.name),
    studentId: studentIdError(values.studentId.trim(), requirement.studentId),
    department: departmentError(
      resolveDepartment(values),
      requirement.department,
    ),
  };
}

export function isProfileFormValid(errors: ProfileFormErrors): boolean {
  return Object.values(errors).every((error) => error === null);
}

export function toCompleteProfileRequest(
  values: ProfileFormValues,
  role: ProfileRole | null,
): CompleteProfileRequest | null {
  const errors = validateProfileForm(values, role);
  if (!isProfileFormValid(errors)) {
    return null;
  }
  const studentId = values.studentId.trim();
  const department = resolveDepartment(values);
  return {
    name: values.name.trim(),
    // 값이 있으면 역할이 요구하지 않아도 그대로 보낸다 — 역할이 바뀐 사용자의
    // 기존 값을 프런트에서 지워 버리지 않기 위해서다. 비어 있을 때만 키를 뺀다.
    ...(studentId ? { studentId } : {}),
    ...(department ? { department } : {}),
  };
}

/** 설정 화면용 — 학번은 읽기 전용(백엔드 `USR_003`)이므로 name·department만 검증한다. */
export function validateSettingsProfileForm(
  values: Pick<
    ProfileFormValues,
    'name' | 'departmentOption' | 'otherDepartment'
  >,
  role: ProfileRole | null,
): Pick<ProfileFormErrors, 'name' | 'department'> {
  return {
    name: nameError(values.name),
    department: departmentError(
      resolveDepartment(values),
      profileFieldRequirement(role).department,
    ),
  };
}

export function toUpdateProfileRequest(
  values: Pick<
    ProfileFormValues,
    'name' | 'departmentOption' | 'otherDepartment'
  >,
  role: ProfileRole | null,
): UpdateProfileRequest | null {
  const errors = validateSettingsProfileForm(values, role);
  if (errors.name !== null || errors.department !== null) {
    return null;
  }
  const department = resolveDepartment(values);
  return {
    name: values.name.trim(),
    ...(department ? { department } : {}),
  };
}
