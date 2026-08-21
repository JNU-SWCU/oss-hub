import type {
  AffiliationKind,
  MemberKind,
  Role,
  RoleRequestStatus,
} from '@prisma/client';

export const MEMBER_AUTHORITY_BACKFILL_VERSION =
  '20260821-member-authority-v1' as const;

export type MemberAuthorityBackfillProfile = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly memberKind: MemberKind | null;
  readonly affiliationKind: AffiliationKind | null;
  readonly affiliationName: string | null;
};

export type MemberAuthorityBackfillUser = {
  readonly id: string;
  readonly githubId: string;
  readonly nickname: string;
  readonly role: Role | null;
  readonly selectedRole: Role | null;
  readonly selectedMemberKind: MemberKind | null;
  readonly hasStaffAccess: boolean | null;
  readonly hasAdminAccess: boolean | null;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly profile: MemberAuthorityBackfillProfile | null;
};

export type MemberAuthorityRequestSnapshot = {
  readonly id: string;
  readonly userId: string;
  readonly status: RoleRequestStatus;
  readonly decidedById: string | null;
};

export type MemberAuthorityAggregate = {
  readonly users: number;
  readonly profiles: number;
  readonly requests: number;
  readonly legacyRoles: {
    readonly STUDENT: number;
    readonly STAFF: number;
    readonly ADMIN: number;
    readonly UNASSIGNED: number;
  };
  readonly memberKinds: {
    readonly STUDENT: number;
    readonly STAFF: number;
    readonly UNRESOLVED_ASSIGNED: number;
  };
  readonly selectedMemberKinds: {
    readonly STUDENT: number;
    readonly STAFF: number;
    readonly UNRESOLVED: number;
  };
  readonly unassignedMemberKinds: {
    readonly STUDENT: number;
    readonly STAFF: number;
    readonly UNRESOLVED: number;
  };
  readonly backfillTargets: {
    readonly memberKinds: { readonly STUDENT: number; readonly STAFF: number };
    readonly selectedMemberKinds: {
      readonly STUDENT: number;
      readonly STAFF: number;
    };
  };
  readonly requestStatuses: Readonly<Record<RoleRequestStatus, number>>;
  readonly requestHistoryHash: string;
  readonly staffAccess: number;
  readonly adminAccess: number;
  readonly compatibilityOnlyAdminAuthorities: number;
};

export type MemberAuthorityBackfillResult = {
  readonly users: readonly MemberAuthorityBackfillUser[];
  readonly changedUsers: number;
  readonly changedProfiles: number;
  readonly createdProfiles: number;
  readonly clearedNonStudentIds: number;
};
