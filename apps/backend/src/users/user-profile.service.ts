import { AccountStatus } from '@prisma/client';
import { MemberKind } from './user-contract.config';
import type {
  AuthorityLabel,
  AuthorityLabelSource,
} from './authority-label.types';

import {
  ProfileFieldRequirement,
  UserApprovalProfile,
  USER_NAME_MAX_LENGTH,
  USER_DEPARTMENT_MAX_LENGTH,
  UserProfileFields,
  UserProfileRecord,
} from './profile-validation.config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class UserProfileService {
  hasStaffAccess(source: UserApprovalProfile): boolean {
    return (
      source.memberKind === MemberKind.STAFF &&
      source.approvalStatus === 'APPROVED' &&
      source.profileCreatedAt !== null &&
      this.isCompleteProfileFields(
        { ...source, studentId: null },
        MemberKind.STAFF,
      )
    );
  }

  isStaffEligible(source: {
    readonly accountStatus: AccountStatus;
    readonly memberKind: MemberKind | null;
    readonly hasStaffAccess: boolean;
    readonly isProfileComplete: boolean;
  }): boolean {
    return (
      source.accountStatus === AccountStatus.ACTIVE &&
      source.memberKind === MemberKind.STAFF &&
      source.hasStaffAccess &&
      source.isProfileComplete
    );
  }

  profileFieldRequirement(
    memberKind: MemberKind | null | undefined,
  ): ProfileFieldRequirement {
    return REQUIREMENT_BY_MEMBER_KIND[
      memberKind ?? DEFAULT_PROFILE_MEMBER_KIND
    ];
  }

  normalizeProfileText(value: string): string {
    return value.trim().normalize('NFC');
  }

  private isValidProfileText(value: string, maxCodePoints: number): boolean {
    const count = Array.from(this.normalizeProfileText(value)).length;
    return count >= 1 && count <= maxCodePoints;
  }

  isValidUserName(name: string): boolean {
    return this.isValidProfileText(name, USER_NAME_MAX_LENGTH);
  }

  isStoredStudentId(studentId: string): boolean {
    return STORED_STUDENT_ID_PATTERN.test(studentId);
  }

  isValidDepartment(department: string): boolean {
    return this.isValidProfileText(department, USER_DEPARTMENT_MAX_LENGTH);
  }

  isCompleteProfileFields(
    fields: UserProfileFields,
    memberKind: MemberKind | null | undefined,
  ): boolean {
    const requirement = this.profileFieldRequirement(memberKind);
    return (
      fields.name !== null &&
      this.isValidUserName(fields.name) &&
      isSatisfied(fields.studentId, requirement.studentId, (studentId) =>
        this.isStoredStudentId(studentId),
      ) &&
      isSatisfied(fields.department, requirement.department, (department) =>
        this.isValidDepartment(department),
      )
    );
  }

  normalizeStaffNumber(value: string): string {
    return value.trim().normalize('NFC');
  }

  isValidStaffNumber(value: string): boolean {
    const normalized = this.normalizeStaffNumber(value);
    const codePointCount = Array.from(normalized).length;
    return codePointCount >= 1 && codePointCount <= 100;
  }

  effectiveProfileMemberKind(
    record: Pick<
      UserProfileRecord,
      'memberKind' | 'hasPendingStaffRequest' | 'selectedMemberKind'
    >,
  ): MemberKind | null {
    if (record.memberKind) {
      return record.memberKind;
    }
    return record.selectedMemberKind ?? null;
  }

  isValidStudentId(studentId: string): boolean {
    return STUDENT_ID_PATTERN.test(studentId);
  }

  isValidPhone(phone: string): boolean {
    return PHONE_PATTERN.test(phone);
  }

  isCompleteUserProfile(
    record: Pick<
      UserProfileRecord,
      | 'name'
      | 'studentId'
      | 'department'
      | 'memberKind'
      | 'selectedMemberKind'
      | 'profileCreatedAt'
    >,
  ): boolean {
    return (
      record.profileCreatedAt !== null &&
      this.effectiveProfileMemberKind(record) !== null &&
      this.isCompleteProfileFields(
        record,
        this.effectiveProfileMemberKind(record),
      )
    );
  }

  isValidCompleteUserProfileFields(fields: {
    readonly name: string;
    readonly studentId: string;
    readonly department: string;
  }): boolean {
    return (
      this.isValidStudentId(fields.studentId) &&
      this.isCompleteProfileFields(fields, DEFAULT_PROFILE_MEMBER_KIND)
    );
  }

  authorityLabel(source: AuthorityLabelSource): AuthorityLabel | null {
    if (source.hasAdminAccess) {
      return 'ADMIN';
    }
    if (source.hasStaffAccess) {
      return 'STAFF';
    }
    return source.memberKind === MemberKind.STUDENT ? 'STUDENT' : null;
  }
}

const DEFAULT_PROFILE_MEMBER_KIND = 'STUDENT' satisfies MemberKind;

const REQUIREMENT_BY_MEMBER_KIND: Record<MemberKind, ProfileFieldRequirement> =
  {
    STUDENT: { studentId: true, department: true },
    STAFF: { studentId: false, department: true },
  };

const STORED_STUDENT_ID_PATTERN = /^\d{6,10}$/;

function isSatisfied(
  value: string | null,
  required: boolean,
  isValid: (value: string) => boolean,
): boolean {
  if (value === null) {
    return !required;
  }
  return isValid(value);
}

const STUDENT_ID_PATTERN = /^\d{6}$/;

const PHONE_PATTERN = /^\d{10,11}$/;
