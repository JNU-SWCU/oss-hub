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

/**
 * 설정 화면이 다루는 프로필 항목.
 *
 * 서버에 이미 저장된 학번을 함께 받는다 — 학번이 수정 가능한지, 저장 요청에
 * 실어야 하는지가 "지금 저장된 값이 있는가"로 갈리기 때문이다. 폼에 입력된
 * `studentId`만으로는 사용자가 방금 친 값인지 불러온 값인지 구분할 수 없다.
 */
export type SettingsProfileFields = Pick<
  ProfileFormValues,
  'name' | 'studentId' | 'departmentOption' | 'otherDepartment'
> & {
  /** 서버에 저장돼 있던 학번. 비어 있으면 아직 학번이 없다는 뜻이다. */
  readonly savedStudentId: string;
};

/** 저장된 학번이 있으면 수정할 수 없다 — 화면은 읽기 전용, 요청에서는 제외. */
export function hasSavedStudentId(values: SettingsProfileFields): boolean {
  return values.savedStudentId.trim().length > 0;
}

/**
 * 설정 화면용 검증.
 *
 * 학번은 아직 저장된 값이 없을 때만 검증한다. 이미 저장돼 있으면 읽기 전용이라
 * 사용자가 만들 수 있는 오류가 없고, 예전에 들어간 값이 지금 형식과 맞지 않더라도
 * 그 때문에 이름·학과 저장까지 막을 이유는 없다.
 */
export function validateSettingsProfileForm(
  values: SettingsProfileFields,
  role: ProfileRole | null,
): ProfileFormErrors {
  const requirement = profileFieldRequirement(role);
  return {
    name: nameError(values.name),
    studentId: hasSavedStudentId(values)
      ? null
      : studentIdError(values.studentId.trim(), requirement.studentId),
    department: departmentError(
      resolveDepartment(values),
      requirement.department,
    ),
  };
}

export function toUpdateProfileRequest(
  values: SettingsProfileFields,
  role: ProfileRole | null,
): UpdateProfileRequest | null {
  const errors = validateSettingsProfileForm(values, role);
  if (!isProfileFormValid(errors)) {
    return null;
  }
  const department = resolveDepartment(values);
  // 저장된 학번이 없을 때 새로 입력한 값만 싣는다. 이미 있는 값을 다시 보내도
  // 백엔드는 통과시키지만, 굳이 불변 항목을 요청에 태우지 않는다.
  const studentId = hasSavedStudentId(values) ? '' : values.studentId.trim();
  return {
    name: values.name.trim(),
    ...(studentId ? { studentId } : {}),
    ...(department ? { department } : {}),
  };
}
