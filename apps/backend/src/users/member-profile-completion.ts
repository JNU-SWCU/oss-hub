import { AffiliationKind, MemberKind } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import type {
  CompleteUserProfileInput,
  PatchUserProfileInput,
  UpdateProfileFieldsInput,
} from './domain/user-profile';
import {
  isStoredStudentId,
  isValidDepartment,
  isValidStudentId,
  isValidUserName,
  normalizeProfileText,
  type UserProfileRecord,
} from './user-profile-policy';

type Affiliation = {
  readonly kind: AffiliationKind;
  readonly name: string;
};

export function buildProfileCompletion(
  user: UserProfileRecord,
  input: PatchUserProfileInput,
): CompleteUserProfileInput {
  const memberKind = user.selectedMemberKind ?? user.memberKind ?? null;
  if (memberKind === null) {
    throw invalidProfile('회원 유형을 먼저 선택해 주세요.');
  }
  const name = normalizeProfileText(input.name);
  if (!isValidUserName(name)) {
    throw invalidProfile('이름 형식이 올바르지 않습니다.');
  }
  const affiliation = resolveAffiliation(user, input);
  requireAllowedAffiliation(memberKind, affiliation.kind);

  return {
    name,
    studentId: completionStudentId(memberKind, user, input),
    department: affiliation.name,
    memberKind,
    affiliationKind: affiliation.kind,
    affiliationName: affiliation.name,
    hasStaffAccess:
      memberKind === MemberKind.STAFF ? (user.hasStaffAccess ?? false) : false,
    hasAdminAccess: user.hasAdminAccess ?? false,
  };
}

export function buildProfileUpdate(
  user: UserProfileRecord,
  input: PatchUserProfileInput,
): UpdateProfileFieldsInput {
  const name = normalizeProfileText(input.name);
  if (!isValidUserName(name)) {
    throw invalidProfile('이름 형식이 올바르지 않습니다.');
  }
  const affiliation = resolveAffiliation(user, input);
  const memberKind = user.memberKind ?? user.selectedMemberKind ?? null;
  if (memberKind !== null) {
    requireAllowedAffiliation(memberKind, affiliation.kind);
  }
  return {
    name,
    department: affiliation.name,
    ...(memberKind === null
      ? {}
      : {
          affiliationKind: affiliation.kind,
          affiliationName: affiliation.name,
        }),
  };
}

function resolveAffiliation(
  user: UserProfileRecord,
  input: PatchUserProfileInput,
): Affiliation {
  const hasKind = input.affiliationKind !== undefined;
  const hasName = input.affiliationName !== undefined;
  if (hasKind !== hasName || (hasKind && input.department !== undefined)) {
    throw invalidProfile('소속 유형과 이름을 하나의 형식으로 보내 주세요.');
  }
  const kind = hasKind
    ? input.affiliationKind
    : (user.affiliationKind ?? AffiliationKind.DEPARTMENT);
  const rawName = hasName ? input.affiliationName : input.department;
  if (kind === undefined || rawName === undefined) {
    throw invalidProfile('소속을 입력해 주세요.');
  }
  const name = normalizeProfileText(rawName);
  if (!isValidDepartment(name)) {
    throw invalidProfile('소속 형식이 올바르지 않습니다.');
  }
  return { kind, name };
}

function completionStudentId(
  memberKind: MemberKind,
  user: UserProfileRecord,
  input: PatchUserProfileInput,
): string | null {
  switch (memberKind) {
    case MemberKind.STUDENT: {
      const studentId = input.studentId ?? user.studentId;
      const valid =
        studentId !== null &&
        (input.studentId === undefined
          ? isStoredStudentId(studentId)
          : isValidStudentId(studentId));
      if (!valid) {
        throw invalidProfile('학생 가입에는 학번이 필요합니다.');
      }
      return studentId;
    }
    case MemberKind.STAFF:
      if (input.studentId !== undefined) {
        throw invalidProfile('학번은 학생만 저장할 수 있습니다.');
      }
      return null;
  }
}

function requireAllowedAffiliation(
  memberKind: MemberKind,
  affiliationKind: AffiliationKind,
): void {
  switch (memberKind) {
    case MemberKind.STUDENT:
      if (affiliationKind !== AffiliationKind.DEPARTMENT) {
        throw invalidProfile('학생 소속은 학과여야 합니다.');
      }
      return;
    case MemberKind.STAFF:
      return;
  }
}

function invalidProfile(message: string): DomainException {
  return new DomainException({
    code: SystemErrorCode.VALIDATION_FAILED,
    status: 400,
    message,
  });
}
