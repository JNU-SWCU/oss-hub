import { DEPARTMENT_OPTIONS, OTHER_DEPARTMENT } from './departments';
import {
  isProfileComplete,
  isValidDepartment,
  isValidPhone,
  isValidProfileName,
  isValidStudentId,
  normalizePhone,
  normalizeProfileText,
  PROFILE_DEPARTMENT_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  profileFieldRequirement,
  type ProfileMemberKind,
  type ProfileRole,
} from './profile-requirements';
import type {
  CompleteProfileRequest,
  ProfileFormErrors,
  ProfileFormValues,
  UpdateProfileRequest,
  UserProfile,
} from './types';

export { PROFILE_DEPARTMENT_MAX_LENGTH, PROFILE_NAME_MAX_LENGTH };

export function getProfileRedirect(
  profile: UserProfile,
  memberKind: ProfileMemberKind | null,
  nextPath: string,
): string | null {
  return isProfileComplete(profile, memberKind) ? nextPath : null;
}

export function createInitialProfileForm(
  profile: UserProfile,
): ProfileFormValues {
  const department = profile.department ?? '';
  const isListed = DEPARTMENT_OPTIONS.includes(department);
  return {
    name: profile.name,
    studentId: profile.studentId ?? '',
    phone: profile.phone ?? '',

    savedStudentId: profile.studentId ?? '',
    affiliationKind: 'DEPARTMENT',
    affiliationName: '',
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

export function resolveAffiliationName(
  values: Pick<
    ProfileFormValues,
    | 'affiliationKind'
    | 'affiliationName'
    | 'departmentOption'
    | 'otherDepartment'
  >,
): string {
  return values.affiliationKind === 'DEPARTMENT'
    ? resolveDepartment(values)
    : values.affiliationName;
}

function nameError(name: string): string | null {
  if (name.trim().length === 0) {
    return '이름을 입력해 주세요.';
  }
  return isValidProfileName(name)
    ? null
    : `이름은 ${PROFILE_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`;
}

function studentIdError(studentId: string, required: boolean): string | null {
  if (!required && studentId.length === 0) {
    return null;
  }
  return isValidStudentId(studentId)
    ? null
    : '학번은 숫자 6자리로 입력해 주세요.';
}

function phoneError(phone: string, required: boolean): string | null {
  const normalizedPhone = normalizePhone(phone);
  if (!required && normalizedPhone.length === 0) {
    return null;
  }
  return isValidPhone(normalizedPhone)
    ? null
    : '전화번호는 숫자 10~11자리로 입력해 주세요.';
}

function departmentError(department: string, required: boolean): string | null {
  if (department.length === 0) {
    return required ? '학과를 선택하거나 입력해 주세요.' : null;
  }
  return isValidDepartment(department)
    ? null
    : `학과는 ${PROFILE_DEPARTMENT_MAX_LENGTH}자 이하로 입력해 주세요.`;
}

function isUnchangedStudentId(
  values: Pick<ProfileFormValues, 'studentId' | 'savedStudentId'>,
): boolean {
  const saved = values.savedStudentId.trim();
  return saved.length > 0 && values.studentId.trim() === saved;
}

export function validateProfileForm(
  values: ProfileFormValues,
  memberKind: ProfileRole | null,
): ProfileFormErrors {
  const requirement = profileFieldRequirement(memberKind);
  const affiliationError =
    memberKind === 'STUDENT' && values.affiliationKind !== 'DEPARTMENT'
      ? '학생은 학과 소속을 선택해 주세요.'
      : departmentError(
          resolveAffiliationName(values),
          profileFieldRequirement(memberKind).department,
        );
  return {
    name: nameError(values.name),
    studentId: isUnchangedStudentId(values)
      ? null
      : studentIdError(values.studentId.trim(), requirement.studentId),
    phone: phoneError(values.phone, requirement.phone),
    department: affiliationError,
  };
}

export function isProfileFormValid(errors: ProfileFormErrors): boolean {
  return Object.values(errors).every((error) => error === null);
}

export function toCompleteProfileRequest(
  values: ProfileFormValues,
  memberKind: ProfileRole | null,
): CompleteProfileRequest | null {
  const errors = validateProfileForm(values, memberKind);
  if (memberKind === 'ADMIN' || !isProfileFormValid(errors)) {
    return null;
  }

  const studentId = isUnchangedStudentId(values) ? '' : values.studentId.trim();
  return {
    name: normalizeProfileText(values.name),
    ...(studentId ? { studentId } : {}),
    ...(normalizePhone(values.phone)
      ? { phone: normalizePhone(values.phone) }
      : {}),
    affiliationKind: values.affiliationKind,
    affiliationName: normalizeProfileText(resolveAffiliationName(values)),
  };
}

export type SettingsProfileFields = Pick<
  ProfileFormValues,
  'name' | 'studentId' | 'phone' | 'departmentOption' | 'otherDepartment'
> & {
  readonly savedStudentId: string;
};

export function hasSavedStudentId(values: SettingsProfileFields): boolean {
  return values.savedStudentId.trim().length > 0;
}

export function validateSettingsProfileForm(
  values: SettingsProfileFields,
  memberKind: ProfileRole | null,
): ProfileFormErrors {
  const requirement = profileFieldRequirement(memberKind);
  return {
    name: nameError(values.name),
    studentId: hasSavedStudentId(values)
      ? null
      : studentIdError(values.studentId.trim(), requirement.studentId),
    phone: phoneError(values.phone, requirement.phone),
    department: departmentError(resolveDepartment(values), true),
  };
}

export function toUpdateProfileRequest(
  values: SettingsProfileFields,
  memberKind: ProfileRole | null,
): UpdateProfileRequest | null {
  const errors = validateSettingsProfileForm(values, memberKind);
  if (!isProfileFormValid(errors)) {
    return null;
  }
  const department = normalizeProfileText(resolveDepartment(values));

  const studentId = hasSavedStudentId(values) ? '' : values.studentId.trim();
  return {
    name: normalizeProfileText(values.name),
    ...(studentId ? { studentId } : {}),
    ...(normalizePhone(values.phone)
      ? { phone: normalizePhone(values.phone) }
      : {}),
    department,
  };
}
