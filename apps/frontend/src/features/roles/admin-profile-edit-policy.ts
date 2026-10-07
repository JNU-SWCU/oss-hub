import { ApiError } from '@/lib/api-client';
import { DEPARTMENT_OPTIONS, OTHER_DEPARTMENT } from '@/lib/departments';

import type {
  AdminAccessProfile,
  AdminProfileUpdateCommand,
} from './admin-access-api';

export const ADMIN_PROFILE_NAME_MAX_LENGTH = 100;
export const ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH = 100;
export const ADMIN_PROFILE_STUDENT_ID_PATTERN = /^\d{6}$/;

export function isValidAdminProfileName(name: string): boolean {
  return name.trim().length > 0 && name.length <= ADMIN_PROFILE_NAME_MAX_LENGTH;
}

export function isValidAdminProfileStudentId(studentId: string): boolean {
  return ADMIN_PROFILE_STUDENT_ID_PATTERN.test(studentId);
}

export function isValidAdminProfileDepartment(department: string): boolean {
  return (
    department.trim().length > 0 &&
    department.length <= ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH
  );
}

export interface AdminProfileEditValues {
  readonly name: string;
  readonly studentId: string;
  readonly departmentOption: string;
  readonly otherDepartment: string;
}

export function createAdminProfileEditValues(
  profile: AdminAccessProfile,
): AdminProfileEditValues {
  const department = profile.department ?? '';
  const isListed = DEPARTMENT_OPTIONS.includes(department);
  return {
    name: profile.name ?? '',
    studentId: profile.studentId ?? '',
    departmentOption: isListed
      ? department
      : department
        ? OTHER_DEPARTMENT
        : '',
    otherDepartment: isListed ? '' : department,
  };
}

export function resolveAdminProfileDepartment(
  values: Pick<AdminProfileEditValues, 'departmentOption' | 'otherDepartment'>,
): string {
  return values.departmentOption === OTHER_DEPARTMENT
    ? values.otherDepartment.trim()
    : values.departmentOption;
}

export interface AdminProfileEditErrors {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
}

function nameError(name: string): string | null {
  if (name.trim().length === 0) {
    return '이름을 입력해 주세요.';
  }
  return isValidAdminProfileName(name)
    ? null
    : `이름은 ${ADMIN_PROFILE_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`;
}

function studentIdError(studentId: string, hadValue: boolean): string | null {
  if (studentId.length === 0) {
    return hadValue ? '이미 저장된 학번은 비워둘 수 없습니다.' : null;
  }
  return isValidAdminProfileStudentId(studentId)
    ? null
    : '학번은 숫자 6자리로 입력해 주세요.';
}

function departmentError(
  department: string,
  hadValue: boolean,
  studentId: string,
): string | null {
  if (department.length === 0) {
    if (hadValue) {
      return '이미 저장된 학과는 비워둘 수 없습니다.';
    }

    return studentId.length > 0
      ? '학번을 저장하려면 학과도 함께 입력해 주세요.'
      : null;
  }
  return isValidAdminProfileDepartment(department)
    ? null
    : `학과는 ${ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH}자 이하로 입력해 주세요.`;
}

export function validateAdminProfileEdit(
  values: AdminProfileEditValues,
  original: AdminAccessProfile,
): AdminProfileEditErrors {
  const studentId = values.studentId.trim();
  const department = resolveAdminProfileDepartment(values);
  return {
    name: nameError(values.name),
    studentId: studentIdError(studentId, (original.studentId ?? '').length > 0),
    department: departmentError(
      department,
      (original.department ?? '').length > 0,
      studentId,
    ),
  };
}

export function isAdminProfileEditValid(
  errors: AdminProfileEditErrors,
): boolean {
  return Object.values(errors).every((error) => error === null);
}

export function toAdminProfileUpdateCommand(
  values: AdminProfileEditValues,
  original: AdminAccessProfile,
): AdminProfileUpdateCommand | null {
  const errors = validateAdminProfileEdit(values, original);
  if (!isAdminProfileEditValid(errors)) {
    return null;
  }
  const name = values.name.trim();
  const studentId = values.studentId.trim();
  const department = resolveAdminProfileDepartment(values);
  const command: {
    name?: string;
    studentId?: string;
    department?: string;
  } = {};
  if (name !== (original.name ?? '')) {
    command.name = name;
  }
  if (studentId !== (original.studentId ?? '')) {
    command.studentId = studentId;
  }
  if (department !== (original.department ?? '')) {
    command.department = department;
  }
  return command;
}

export function adminProfileUpdateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail;
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
