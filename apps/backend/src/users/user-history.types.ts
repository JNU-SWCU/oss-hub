import type { ApprovalStatus, UserType } from '@prisma/client';
import type { StaffAccessRequestStatus } from './user-contract.config';
import type {
  AccessAuditMetadata,
  IndependentAuthorityAuditMetadata,
  UserProfileAuditMetadata,
  UserPhoneAuditMetadata,
} from '../platform/audit-log-metadata.config';

export type RequestSnapshot = {
  readonly id: string;
  readonly userId: string;
  readonly status: StaffAccessRequestStatus;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedById: string | null;
  readonly rejectionReason: string | null;
};

type ApprovalState = {
  readonly type: UserType;
  readonly approvalStatus: ApprovalStatus;
  readonly approvalRequestId: string | null;
};

export type ApprovalRecord = ApprovalState & {
  readonly id: string;
  readonly approvalRequestedAt: Date | null;
  readonly approvalDecidedAt: Date | null;
  readonly approvalDecidedById: string | null;
  readonly approvalReason: string | null;
};

type UserAuditMetadata =
  | AccessAuditMetadata
  | IndependentAuthorityAuditMetadata
  | UserProfileAuditMetadata
  | UserPhoneAuditMetadata;

export type UserAuditInput = {
  readonly beforeProfile?: Readonly<Record<string, string | null>>;
  readonly actorGithubId: bigint;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: UserAuditMetadata;
};
