import type { ApprovalStatus } from '@prisma/client';
import type { MemberKind } from './user-contract.config';
import type { AuthorityLabel } from './authority-label.types';
import type { UserProfileAuditFieldChange } from '../platform/audit-log-metadata.config';
import type { MemberKindProfileUpdate } from './member-kind.repository';
export type MemberKindUpdate = {
  readonly changed: boolean;
  readonly authorityChanged: boolean;
  readonly hasStaffAccess: boolean;
  readonly role: AuthorityLabel | null;
  readonly profileChanges: readonly UserProfileAuditFieldChange[];
  readonly profile: MemberKindProfileUpdate;
};

export type MemberKindMutationCommand = {
  readonly memberKind: MemberKind;
  readonly expectedMemberKind: MemberKind;
  readonly expectedHasStaffAccess: boolean;
  readonly expectedApprovalStatus?: ApprovalStatus;
  readonly expectedApprovalRequestId?: string | null;
  readonly studentId?: string;
  readonly department?: string;
  readonly staffNumber?: string | null;
};
