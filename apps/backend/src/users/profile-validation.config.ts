import type { ApprovalStatus } from '@prisma/client';
import { MemberKind, type DepartmentType } from './user-contract.config';

export interface UserProfileRecord {
  readonly id: string;
  readonly profileCreatedAt: Date | null;
  readonly approvalStatus: ApprovalStatus;
  readonly approvalRequestId: string | null;
  readonly githubId?: bigint;
  readonly githubLogin?: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly phone?: string | null;

  readonly staffNumber?: string | null;

  readonly hasPendingStaffRequest?: boolean;

  readonly selectedMemberKind: MemberKind | null;
  readonly memberKind: MemberKind | null;
  readonly departmentType?: DepartmentType | null;
  readonly hasAdminAccess?: boolean;
}

export type UserProfileFields = Pick<
  UserProfileRecord,
  'name' | 'studentId' | 'department'
>;

export const USER_NAME_MAX_LENGTH = 100;

export const USER_DEPARTMENT_MAX_LENGTH = 100;

export const PROFILE_TEXT_PATTERN = /^[\s\S]{1,100}$/u;

export interface ProfileFieldRequirement {
  readonly studentId: boolean;
  readonly department: boolean;
}

export type UserApprovalProfile = {
  readonly memberKind: MemberKind | null;
  readonly approvalStatus: ApprovalStatus;
  readonly profileCreatedAt: Date | null;
  readonly name: string | null;
  readonly department: string | null;
};
