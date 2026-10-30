import type {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.repository';
import type { AdminAccessActor } from './admin-access-repository.types';
import type { ConsentPolicy } from './user-profile.policy';

export interface AccountDeactivationResult {
  readonly accountStatus: typeof AccountStatus.DEACTIVATED;
}

export type AdminProfileTargetRecord = {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly memberKind?: MemberKind | null;
};

export type AdminProfileWriteFields = {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
};

export type AdminProfileLegacyFields = {
  readonly name?: string;
  readonly department?: string;
};

export type AdminProfileApplyOutcome = 'applied' | 'studentIdTaken';

export interface AdminProfileTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;

  lockActiveAdmins(): Promise<void>;
  findActor(githubId: bigint): Promise<AdminAccessActor | null>;
  findTarget(userId: string): Promise<AdminProfileTargetRecord | null>;

  applyProfile(
    userId: string,
    fields: AdminProfileWriteFields,
    changedFields: Partial<AdminProfileWriteFields>,
  ): Promise<AdminProfileApplyOutcome>;
  applyLegacyFields(
    userId: string,
    fields: AdminProfileLegacyFields,
  ): Promise<void>;
}

export interface AdminProfileRepositoryPort {
  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T>;
}

export interface ConsentStatus {
  policy: ConsentPolicy;
  consented: boolean;
}

export interface ConsentGrant {
  policyVersion: string;
  consentedAt: Date;
  nextUrl: string;
}

export interface ConsentUser {
  readonly id: string;
  readonly accountStatus: AccountStatus;
}

export interface ConsentRecord {
  policyVersion: string;
  consentedAt: Date;
}

export type SelectableMemberKind = MemberKind;

type MemberProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

export type MemberUser = {
  readonly id: string;

  readonly memberKind: MemberKind | null;

  readonly selectedMemberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;

  readonly profile: MemberProfileFields;
};

export type StaffAccessRequestRecord = {
  readonly id: string;
  readonly userId: string;
  readonly status: StaffAccessRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
};

export type MemberKindSelectionResult = {
  readonly selectedMemberKind: SelectableMemberKind;

  readonly redirectTo: '/onboarding/profile';
};

export type MemberKindSelectionState = {
  readonly selectedMemberKind: SelectableMemberKind | null;
};
