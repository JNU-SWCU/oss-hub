import type { AuthorityLabel } from '../users/authority-label.types';
import {
  AccountStatus,
  StaffAccessRequestStatus,
  ApplicationStatus,
  MemberKind,
  RepositoryVisibility,
  ProgramLifecycle,
} from '@prisma/client';
import {
  type ApplicationRepositoryUrlAuditMetadataView,
  type RepositoryConnectionAuditMetadataView,
} from './repository-audit-metadata.config';

export const COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION = 1 as const;

export type CollectionTriggerAuditMetadata = {
  readonly schemaVersion: typeof COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION;
  readonly runId: string;
};

export type CollectionTriggerAuditMetadataView = Omit<
  CollectionTriggerAuditMetadata,
  'runId'
>;

export const SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION = 1 as const;

export type SubmissionFileCleanupAuditMetadata = {
  readonly schemaVersion: typeof SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION;
  readonly fileId: string;
};

export const ACCESS_AUDIT_SCHEMA_VERSION_V1 = 1 as const;

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

export type AuditActorSnapshot = AuditPersonSnapshot;

type AuditTargetSnapshot = AuditPersonSnapshot;

export type AccessAuditState = {
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
  readonly requestStatus: StaffAccessRequestStatus | null;
};

type AccessAuditMetadataBaseV1 = {
  readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION_V1;
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

export type AccessAuditMetadataView =
  | (Omit<AccessAuditMetadataV1, 'rejectionReason'> & {
      readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION_V1;
    })
  | (Omit<AccessAuditMetadataV2, 'rejectionReason'> & {
      readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION;
    });

export const APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1 = 1 as const;

export const APPLICATION_DECISION_AUDIT_SCHEMA_VERSION = 2 as const;

type ApplicationDecisionAuditMetadataBaseV1 = {
  readonly schemaVersion: typeof APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1;
  readonly before: { readonly status: ApplicationStatus };
  readonly after: { readonly status: ApplicationStatus };
};

type ApplicationDecisionAuditMetadataBaseV2 = {
  readonly schemaVersion: typeof APPLICATION_DECISION_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly applicantGithubLogin: string;
  readonly before: { readonly status: ApplicationStatus };
  readonly after: { readonly status: ApplicationStatus };
};

type ApplicationDecisionAuditMetadataV1 =
  ApplicationDecisionAuditMetadataBaseV1;

export type ApplicationDecisionAuditMetadataV2 =
  ApplicationDecisionAuditMetadataBaseV2;

export type ApplicationDecisionAuditMetadata =
  ApplicationDecisionAuditMetadataV1 | ApplicationDecisionAuditMetadataV2;

export type ApplicationDecisionAuditMetadataView =
  ApplicationDecisionAuditMetadata;

export const INDEPENDENT_AUTHORITY_AUDIT_ACTIONS = {
  GRANT_STAFF_ACCESS: 'GRANT_STAFF_ACCESS',
  REVOKE_STAFF_ACCESS: 'REVOKE_STAFF_ACCESS',
  GRANT_ADMIN_ACCESS: 'GRANT_ADMIN_ACCESS',
  REVOKE_ADMIN_ACCESS: 'REVOKE_ADMIN_ACCESS',
  SET_MEMBER_KIND: ACCESS_AUDIT_ACTIONS.DIRECT_ROLE_CHANGED,
} as const;

export const INDEPENDENT_AUTHORITY_AUDIT_COMMANDS = {
  ...INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  SET_MEMBER_KIND: 'SET_MEMBER_KIND',
} as const;

export type IndependentAuthorityAuditCommand =
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

export type IndependentAuthorityAuditMetadataView =
  IndependentAuthorityAuditMetadata;

export const REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1 = 1 as const;

export const REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION = 2 as const;

export type RepositoryPublishAuditVisibilityState = {
  readonly visibility: RepositoryVisibility;
};

type RepositoryPublishAuditMetadataBaseV1 = {
  readonly schemaVersion: typeof REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1;
  readonly repositoryId: string;
  readonly before: RepositoryPublishAuditVisibilityState;
  readonly after: RepositoryPublishAuditVisibilityState & {
    readonly publishedAt: string;
  };
};

type RepositoryPublishAuditMetadataBaseV2 = {
  readonly schemaVersion: typeof REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION;
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly before: RepositoryPublishAuditVisibilityState;
  readonly after: RepositoryPublishAuditVisibilityState & {
    readonly publishedAt: string;
  };
};

type RepositoryPublishAuditMetadataV1 = RepositoryPublishAuditMetadataBaseV1;

export type RepositoryPublishAuditMetadataV2 =
  RepositoryPublishAuditMetadataBaseV2;

export type RepositoryPublishAuditMetadata =
  RepositoryPublishAuditMetadataV1 | RepositoryPublishAuditMetadataV2;

export type RepositoryPublishAuditMetadataView = RepositoryPublishAuditMetadata;

export const PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1 = 1 as const;

export const PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION = 2 as const;

type ProgramLifecycleAuditMetadataBaseV1 = {
  readonly schemaVersion: typeof PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1;
  readonly before: { readonly lifecycle: ProgramLifecycle };
  readonly after: { readonly lifecycle: ProgramLifecycle };
};

type ProgramLifecycleAuditMetadataBaseV2 = {
  readonly schemaVersion: typeof PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly before: { readonly lifecycle: ProgramLifecycle };
  readonly after: { readonly lifecycle: ProgramLifecycle };
};

type ProgramLifecycleAuditMetadataV1 = ProgramLifecycleAuditMetadataBaseV1;

export type ProgramLifecycleAuditMetadataV2 =
  ProgramLifecycleAuditMetadataBaseV2;

export type ProgramLifecycleAuditMetadata =
  ProgramLifecycleAuditMetadataV1 | ProgramLifecycleAuditMetadataV2;

export type ProgramLifecycleAuditMetadataView = ProgramLifecycleAuditMetadata;

export const PROGRAM_DELETION_AUDIT_SCHEMA_VERSION = 1 as const;

export type ProgramDeletionAuditBlockingCounts = {
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

export type ProgramDeletionAuditMetadataView = ProgramDeletionAuditMetadata;

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

export type UserProfileAuditMetadataView =
  UserProfileAuditMetadata | UserPhoneAuditMetadata;

export const PROGRAM_CREATED_AUDIT_SCHEMA_VERSION = 1 as const;

export type ProgramCreatedAuditMetadata = {
  readonly schemaVersion: typeof PROGRAM_CREATED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
};

export type ProgramCreatedAuditMetadataView = ProgramCreatedAuditMetadata;

export const TEAM_CREATED_AUDIT_SCHEMA_VERSION = 1 as const;

export type TeamCreatedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_CREATED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
};

export type TeamCreatedAuditMetadataView = TeamCreatedAuditMetadata;

export const TEAM_JOINED_AUDIT_SCHEMA_VERSION = 1 as const;

export type TeamJoinedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_JOINED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
};

export type TeamJoinedAuditMetadataView = TeamJoinedAuditMetadata;

export const APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION = 1 as const;

export type ApplicationSubmittedAuditMetadata = {
  readonly schemaVersion: typeof APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
};

export type ApplicationSubmittedAuditMetadataView =
  ApplicationSubmittedAuditMetadata;

export const TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION = 1 as const;

export const TEAM_MEMBERSHIP_AUDIT_OPERATIONS = {
  LEAVE: 'LEAVE',
  REMOVE: 'REMOVE',
  TRANSFER_LEADER: 'TRANSFER_LEADER',
} as const;

export type TeamMembershipAuditOperation =
  (typeof TEAM_MEMBERSHIP_AUDIT_OPERATIONS)[keyof typeof TEAM_MEMBERSHIP_AUDIT_OPERATIONS];

export type TeamMembershipAuditMetadata = {
  readonly schemaVersion: typeof TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
  readonly operation: TeamMembershipAuditOperation;

  readonly removedUserId: string | null;
  readonly previousLeaderId: string;
  readonly nextLeaderId: string | null;
};

export type TeamMembershipAuditMetadataView = TeamMembershipAuditMetadata;

export const TEAM_RENAMED_AUDIT_SCHEMA_VERSION = 1 as const;

export type TeamRenamedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_RENAMED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
  readonly previousName: string;
};

export type TeamRenamedAuditMetadataView = TeamRenamedAuditMetadata;

export const TEAM_DELETED_AUDIT_SCHEMA_VERSION = 1 as const;

export type TeamDeletedAuditCounts = {
  readonly applications: number;
  readonly members: number;
  readonly invitations: number;
  readonly submissions: number;
  readonly submissionEvents: number;
  readonly detachedRepositories: number;
};

export type TeamDeletedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_DELETED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
  readonly deletedCounts: TeamDeletedAuditCounts;
};

export type TeamDeletedAuditMetadataView = TeamDeletedAuditMetadata;

export type AuditLogMetadataView =
  | ApplicationRepositoryUrlAuditMetadataView
  | AccessAuditMetadataView
  | IndependentAuthorityAuditMetadataView
  | RepositoryConnectionAuditMetadataView
  | RepositoryPublishAuditMetadataView
  | ProgramLifecycleAuditMetadataView
  | ProgramDeletionAuditMetadataView
  | ProgramCreatedAuditMetadataView
  | TeamCreatedAuditMetadataView
  | TeamDeletedAuditMetadataView
  | TeamJoinedAuditMetadataView
  | TeamMembershipAuditMetadataView
  | TeamRenamedAuditMetadataView
  | ApplicationSubmittedAuditMetadataView
  | CollectionTriggerAuditMetadataView
  | SubmissionFileCleanupAuditMetadata
  | ApplicationDecisionAuditMetadataView
  | UserProfileAuditMetadataView;

export type AuditLogMetadataEvidence =
  | { readonly legacy: true; readonly metadata: null }
  | { readonly legacy: false; readonly metadata: AuditLogMetadataView };

export const COLLECTION_TRIGGER_AUDIT_ACTIONS = {
  COLLECTION_SYNC_TRIGGERED: 'COLLECTION_SYNC_TRIGGERED',
} as const;

export const SUBMISSION_FILE_CLEANUP_AUDIT_ACTIONS = {
  SUBMISSION_FILE_CLEANUP_RETRY_RESET: 'SUBMISSION_FILE_CLEANUP_RETRY_RESET',
} as const;

export const APPLICATION_DECISION_AUDIT_ACTIONS = {
  APPLICATION_APPROVED: 'APPLICATION_APPROVED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  APPLICATION_REVERTED: 'APPLICATION_REVERTED',
} as const;

export const REPOSITORY_PUBLISH_AUDIT_ACTIONS = {
  REPOSITORY_PUBLISHED: 'REPOSITORY_PUBLISHED',
} as const;

export const PROGRAM_LIFECYCLE_AUDIT_ACTIONS = {
  PROGRAM_ARCHIVED: 'PROGRAM_ARCHIVED',
  PROGRAM_RESTORED: 'PROGRAM_RESTORED',
} as const;

export const PROGRAM_DELETION_AUDIT_ACTIONS = {
  PROGRAM_DELETED: 'PROGRAM_DELETED',
} as const;

export const USER_PROFILE_AUDIT_ACTIONS = {
  PROFILE_UPDATED: 'USER_PROFILE_UPDATED',
  PHONE_UPDATED: 'USER_PHONE_UPDATED',
} as const;

export const PROGRAM_CREATED_AUDIT_ACTIONS = {
  PROGRAM_CREATED: 'PROGRAM_CREATED',
} as const;

export const TEAM_CREATED_AUDIT_ACTIONS = {
  TEAM_CREATED: 'TEAM_CREATED',
} as const;

export const TEAM_JOINED_AUDIT_ACTIONS = {
  TEAM_JOINED: 'TEAM_JOINED',
} as const;

export const APPLICATION_SUBMITTED_AUDIT_ACTIONS = {
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
} as const;

export const TEAM_MEMBERSHIP_AUDIT_ACTIONS = {
  TEAM_MEMBERSHIP_CHANGED: 'TEAM_MEMBERSHIP_CHANGED',
} as const;

export const TEAM_RENAMED_AUDIT_ACTIONS = {
  TEAM_RENAMED: 'TEAM_RENAMED',
} as const;

export const TEAM_DELETED_AUDIT_ACTIONS = {
  TEAM_DELETED: 'TEAM_DELETED',
} as const;
