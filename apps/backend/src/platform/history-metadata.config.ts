import type {
  AccountStatus,
  ProgramLifecycle,
  RepositoryVisibility,
  UserType,
} from '@prisma/client';
import type { AuthorityLabel } from '../users/authority-label.types';
import type {
  StaffAccessRequestStatus,
  MemberKind,
} from '../users/user-contract.config';

export const ACCESS_AUDIT_SCHEMA_VERSION = 2 as const;

export const ACCESS_AUDIT_EVENT_KINDS = {
  ROLE_REQUEST_APPROVED: 'ROLE_REQUEST_APPROVED',
  ROLE_REQUEST_REJECTED: 'ROLE_REQUEST_REJECTED',
  ROLE_REQUEST_REVOKED: 'ROLE_REQUEST_REVOKED',
  ROLE_REQUEST_RESTORED: 'ROLE_REQUEST_RESTORED',
  DIRECT_ROLE_CHANGED: 'DIRECT_ROLE_CHANGED',
  ACCOUNT_STATUS_CHANGED: 'ACCOUNT_STATUS_CHANGED',
  INDEPENDENT_AUTHORITY_CHANGED: 'INDEPENDENT_AUTHORITY_CHANGED',
} as const;

export const ACCESS_AUDIT_ACTIONS = {
  ROLE_REQUEST_APPROVED: 'STAFF_ROLE_REQUEST_APPROVED',
  ROLE_REQUEST_REJECTED: 'STAFF_ROLE_REQUEST_REJECTED',
  ROLE_REQUEST_REVOKED: 'STAFF_ROLE_REQUEST_REVOKED',
  ROLE_REQUEST_RESTORED: 'STAFF_ROLE_REQUEST_RESTORED',
  DIRECT_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  ACCOUNT_STATUS_CHANGED: 'USER_ACCOUNT_STATUS_CHANGED',
} as const;

export type AuditPersonSnapshot = {
  readonly displayName: string | null;
  readonly githubLogin: string;
};

type AuditActorSnapshot = AuditPersonSnapshot;

type AuditTargetSnapshot = AuditPersonSnapshot;

type AccessAuditState = {
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
  readonly requestStatus: StaffAccessRequestStatus | null;
};

type AccessAuditMetadataBaseV1 = {
  readonly schemaVersion: 1;
  readonly actor: AuditActorSnapshot;
  readonly before: AccessAuditState;
  readonly after: AccessAuditState;
};

type AccessAuditMetadataBaseV2 = {
  readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION;
  readonly actor: AuditActorSnapshot;
  readonly target: AuditTargetSnapshot;
  readonly before: AccessAuditState;
  readonly after: AccessAuditState;
};

type AccessAuditEventUnion<Base> =
  | (Base & { readonly eventKind: 'ROLE_REQUEST_APPROVED' })
  | (Base & {
      readonly eventKind: 'ROLE_REQUEST_REJECTED';
      readonly rejectionReason: string;
    })
  | (Base & { readonly eventKind: 'ROLE_REQUEST_REVOKED' })
  | (Base & { readonly eventKind: 'ROLE_REQUEST_RESTORED' })
  | (Base & { readonly eventKind: 'DIRECT_ROLE_CHANGED' })
  | (Base & { readonly eventKind: 'ACCOUNT_STATUS_CHANGED' });

type AccessAuditMetadataV1 = AccessAuditEventUnion<AccessAuditMetadataBaseV1>;

export type AccessAuditMetadataV2 =
  AccessAuditEventUnion<AccessAuditMetadataBaseV2>;

export type AccessAuditMetadata = AccessAuditMetadataV1 | AccessAuditMetadataV2;

export const INDEPENDENT_AUTHORITY_AUDIT_ACTIONS = {
  GRANT_STAFF_ACCESS: 'GRANT_STAFF_ACCESS',
  REVOKE_STAFF_ACCESS: 'REVOKE_STAFF_ACCESS',
  GRANT_ADMIN_ACCESS: 'GRANT_ADMIN_ACCESS',
  REVOKE_ADMIN_ACCESS: 'REVOKE_ADMIN_ACCESS',
  SET_MEMBER_KIND: ACCESS_AUDIT_ACTIONS.DIRECT_ROLE_CHANGED,
  RESET_MEMBER_KIND: ACCESS_AUDIT_ACTIONS.DIRECT_ROLE_CHANGED,
} as const;

export const INDEPENDENT_AUTHORITY_AUDIT_COMMANDS = {
  ...INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  SET_MEMBER_KIND: 'SET_MEMBER_KIND',
  RESET_MEMBER_KIND: 'RESET_MEMBER_KIND',
} as const;

type IndependentAuthorityAuditCommand =
  (typeof INDEPENDENT_AUTHORITY_AUDIT_COMMANDS)[keyof typeof INDEPENDENT_AUTHORITY_AUDIT_COMMANDS];

export type IndependentAuthorityAuditState = {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
};

export type IndependentAuthorityAuditMetadata = {
  readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION;
  readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.INDEPENDENT_AUTHORITY_CHANGED;
  readonly command: IndependentAuthorityAuditCommand;
  readonly actor: AuditActorSnapshot;
  readonly target: AuditTargetSnapshot;
  readonly before: IndependentAuthorityAuditState;
  readonly after: IndependentAuthorityAuditState;
};

export const REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION = 2 as const;

type RepositoryPublishAuditVisibilityState = {
  readonly visibility: RepositoryVisibility;
};

export type RepositoryPublishAuditMetadataV2 = {
  readonly schemaVersion: typeof REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION;
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly before: RepositoryPublishAuditVisibilityState;
  readonly after: RepositoryPublishAuditVisibilityState & {
    readonly publishedAt: string;
  };
};

export const PROGRAM_DELETION_AUDIT_SCHEMA_VERSION = 1 as const;

type ProgramDeletionAuditBlockingCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly submissions: number;
  readonly boardPosts: number;
};

export type ProgramDeletionAuditMetadata = {
  readonly schemaVersion: typeof PROGRAM_DELETION_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly lifecycle: ProgramLifecycle;
  readonly blockingCounts: ProgramDeletionAuditBlockingCounts;
};

export const USER_PROFILE_AUDIT_SCHEMA_VERSION = 1 as const;

export const USER_PROFILE_AUDIT_FIELDS = {
  NAME: 'name',
  STUDENT_ID: 'studentId',
  DEPARTMENT: 'department',
  STAFF_NUMBER: 'staffNumber',
} as const;

type UserProfileAuditFieldName =
  (typeof USER_PROFILE_AUDIT_FIELDS)[keyof typeof USER_PROFILE_AUDIT_FIELDS];

export type UserProfileAuditFieldChange = {
  readonly field: UserProfileAuditFieldName;
  readonly before: string | null;
  readonly after: string | null;
};

export type UserProfileAuditMetadata = {
  readonly schemaVersion: typeof USER_PROFILE_AUDIT_SCHEMA_VERSION;
  readonly actor: AuditActorSnapshot;
  readonly target: AuditTargetSnapshot;
  readonly changes: readonly UserProfileAuditFieldChange[];
};

export const USER_PHONE_AUDIT_TRANSITIONS = {
  SET: 'SET',
  REPLACED: 'REPLACED',
} as const;

export type UserPhoneAuditTransition =
  (typeof USER_PHONE_AUDIT_TRANSITIONS)[keyof typeof USER_PHONE_AUDIT_TRANSITIONS];

export type UserPhoneAuditMetadata = {
  readonly schemaVersion: typeof USER_PROFILE_AUDIT_SCHEMA_VERSION;
  readonly actor: AuditActorSnapshot;
  readonly target: AuditTargetSnapshot;
  readonly transition: UserPhoneAuditTransition;
};

export const PROGRAM_CREATED_AUDIT_SCHEMA_VERSION = 1 as const;

export type ProgramCreatedAuditMetadata = {
  readonly schemaVersion: typeof PROGRAM_CREATED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
};

export const TEAM_JOINED_AUDIT_SCHEMA_VERSION = 1 as const;

export type TeamJoinedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_JOINED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
};

export type HistoryAuditMetadataView =
  | {
      readonly schemaVersion: 1;
      readonly recordKind: 'SIGNUP' | 'BOOTSTRAP';
    }
  | {
      readonly schemaVersion: 1;
      readonly recordKind: 'TYPE_SELECTION';
      readonly before: UserType;
      readonly after: UserType;
    }
  | {
      readonly schemaVersion: 1;
      readonly recordKind: 'REQUEST_TRANSITION';
      readonly requestId: string;
      readonly status: StaffAccessRequestStatus;
      readonly cause?: 'SUPERSEDED' | 'TYPE_CHANGED' | 'ADMIN_TYPE_CHANGE';
      readonly replacementRequestId?: string | null;
    };

export const USER_PROFILE_AUDIT_ACTIONS = {
  PROFILE_UPDATED: 'USER_PROFILE_UPDATED',
  PHONE_UPDATED: 'USER_PHONE_UPDATED',
} as const;

export type AccessAuditAction =
  (typeof ACCESS_AUDIT_ACTIONS)[keyof typeof ACCESS_AUDIT_ACTIONS];

type DistributiveOmit<T, Key extends PropertyKey> = T extends T
  ? Omit<T, Key>
  : never;

export type AccessAuditMetadataInput = DistributiveOmit<
  AccessAuditMetadataV2,
  'schemaVersion'
>;

export type IndependentAuthorityAuditAction =
  (typeof INDEPENDENT_AUTHORITY_AUDIT_ACTIONS)[keyof typeof INDEPENDENT_AUTHORITY_AUDIT_ACTIONS];

export type IndependentAuthorityAuditMetadataInput = Omit<
  IndependentAuthorityAuditMetadata,
  'schemaVersion' | 'eventKind'
>;

export type RepositoryPublishAuditMetadataInput = Omit<
  RepositoryPublishAuditMetadataV2,
  'schemaVersion'
>;

export type UserProfileAuditAction =
  (typeof USER_PROFILE_AUDIT_ACTIONS)[keyof typeof USER_PROFILE_AUDIT_ACTIONS];

export type UserHistoryRecordInput = {
  readonly actorGithubId: bigint;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata:
    | AccessAuditMetadata
    | IndependentAuthorityAuditMetadata
    | UserProfileAuditMetadata
    | UserPhoneAuditMetadata;
};
