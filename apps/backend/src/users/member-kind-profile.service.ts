import { DepartmentType, MemberKind } from './user-contract.config';
import { UserProfileService } from './user-profile.service';
import { DomainException } from '../platform/error-code.error';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';
import type { MemberKindTargetRecord } from './member-kind.repository';
import type { MemberKindMutationCommand } from './member-kind-profile.types';
import type { MemberKindUpdate } from './member-kind-profile.types';
import {
  USER_PROFILE_AUDIT_FIELDS,
  type UserProfileAuditFieldChange,
} from '../platform/audit-log-metadata.config';
import { SystemErrorCode } from '../platform/system-error-code.error';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MemberKindProfileService {
  constructor(private readonly userProfileService: UserProfileService) {}
  resolveMemberKindUpdate(
    before: MemberKindTargetRecord & { readonly hasStaffAccess: boolean },
    command: MemberKindMutationCommand,
  ): MemberKindUpdate {
    const profile = before.profile;
    if (!profile) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
      );
    }

    const providedStudentId = this.parseStudentId(command.studentId);
    const providedDepartment = this.parseDepartment(command.department);
    const providedStaffNumber = this.parseStaffNumber(command.staffNumber);

    if (command.memberKind === MemberKind.STUDENT) {
      if (
        profile.studentId !== null &&
        providedStudentId !== undefined &&
        providedStudentId !== profile.studentId
      ) {
        throw validationError(
          '학생 전환에서는 기존 학번을 변경할 수 없습니다.',
        );
      }
      const studentId = providedStudentId ?? profile.studentId;
      if (
        studentId === null ||
        !this.userProfileService.isStoredStudentId(studentId)
      ) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
        );
      }
      if (providedDepartment === undefined) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT],
        );
      }
      const hasStaffAccess = false;
      const profilePatch = {
        memberKind: MemberKind.STUDENT,
        ...(studentId !== profile.studentId ? { studentId } : {}),
        department: providedDepartment,
        departmentType: DepartmentType.DEPARTMENT,
        ...(providedStaffNumber !== undefined
          ? { staffNumber: providedStaffNumber }
          : {}),
      };
      const authorityChanged =
        before.memberKind !== MemberKind.STUDENT ||
        before.hasStaffAccess !== hasStaffAccess;
      const profileChanges = profileAuditChanges({
        before: profile,
        studentId,
        department: providedDepartment,
        staffNumber: providedStaffNumber,
      });
      const changed =
        authorityChanged ||
        profileChanges.length > 0 ||
        profile.departmentType !== DepartmentType.DEPARTMENT;
      return {
        changed,
        authorityChanged,
        hasStaffAccess,
        role: this.userProfileService.authorityLabel({
          memberKind: MemberKind.STUDENT,
          hasStaffAccess,
          hasAdminAccess: before.hasAdminAccess,
        }),
        profileChanges,
        profile: profilePatch,
      };
    }

    if (
      providedStudentId !== undefined &&
      providedStudentId !== profile.studentId
    ) {
      throw validationError(
        '교직원 전환에서는 기존 학번을 변경할 수 없습니다.',
      );
    }
    if (
      providedDepartment !== undefined &&
      providedDepartment !== profile.department
    ) {
      throw validationError(
        '교직원 전환에서는 기존 소속을 변경할 수 없습니다.',
      );
    }

    const hasStaffAccess = true;
    const profilePatch = {
      memberKind: MemberKind.STAFF,
      ...(providedStaffNumber !== undefined
        ? { staffNumber: providedStaffNumber }
        : {}),
    };
    const authorityChanged =
      before.memberKind !== MemberKind.STAFF ||
      before.hasStaffAccess !== hasStaffAccess;
    const profileChanges = profileAuditChanges({
      before: profile,
      studentId: profile.studentId,
      department: profile.department,
      staffNumber: providedStaffNumber,
    });
    const changed = authorityChanged || profileChanges.length > 0;
    return {
      changed,
      authorityChanged,
      hasStaffAccess,
      role: this.userProfileService.authorityLabel({
        memberKind: MemberKind.STAFF,
        hasStaffAccess,
        hasAdminAccess: before.hasAdminAccess,
      }),
      profileChanges,
      profile: profilePatch,
    };
  }

  private parseStudentId(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw validationError('학번 형식이 올바르지 않습니다.');
    }
    const normalized = value.trim();
    if (!this.userProfileService.isValidStudentId(normalized)) {
      throw validationError('학번 형식이 올바르지 않습니다.');
    }
    return normalized;
  }

  private parseDepartment(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw validationError('학과 형식이 올바르지 않습니다.');
    }
    const normalized = this.userProfileService.normalizeProfileText(value);
    if (!this.userProfileService.isValidDepartment(normalized)) {
      throw validationError('학과 형식이 올바르지 않습니다.');
    }
    return normalized;
  }

  private parseStaffNumber(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined || value === null) {
      return value;
    }
    if (typeof value !== 'string') {
      throw validationError('교직원 번호 형식이 올바르지 않습니다.');
    }
    const normalized = this.userProfileService.normalizeStaffNumber(value);
    if (!this.userProfileService.isValidStaffNumber(normalized)) {
      throw validationError('교직원 번호 형식이 올바르지 않습니다.');
    }
    return normalized;
  }
}

function profileAuditChanges(input: {
  readonly before: NonNullable<MemberKindTargetRecord['profile']>;
  readonly studentId: string | null;
  readonly department: string;
  readonly staffNumber: string | null | undefined;
}): UserProfileAuditFieldChange[] {
  const changes: UserProfileAuditFieldChange[] = [];
  const nextStaffNumber =
    input.staffNumber === undefined
      ? input.before.staffNumber
      : input.staffNumber;
  if (input.before.studentId !== input.studentId) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.STUDENT_ID,
      before: input.before.studentId,
      after: input.studentId,
    });
  }
  if (input.before.department !== input.department) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.DEPARTMENT,
      before: input.before.department,
      after: input.department,
    });
  }
  if (input.before.staffNumber !== nextStaffNumber) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.STAFF_NUMBER,
      before: input.before.staffNumber,
      after: nextStaffNumber,
    });
  }
  return changes;
}

function validationError(message: string): DomainException {
  return new DomainException({
    code: SystemErrorCode.VALIDATION_FAILED,
    status: 400,
    message,
  });
}
