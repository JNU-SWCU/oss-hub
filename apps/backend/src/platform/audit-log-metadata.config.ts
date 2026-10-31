import type { AuthorityLabel } from '../users/authority-label.types';
import {
  AccountStatus,
  StaffAccessRequestStatus,
  ApplicationStatus,
  MemberKind,
  RepositoryVisibility,
  ProgramLifecycle,
} from '@prisma/client';
import { InvalidAuditLogMetadataError } from './audit-log-error-code.error';
import {
  parseApplicationRepositoryUrlAuditMetadata,
  isJsonObject,
  type ApplicationRepositoryUrlAuditMetadataView,
  parseRepositoryConnectionAuditMetadata,
  type RepositoryConnectionAuditMetadataView,
} from './repository-audit-metadata.config';

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export const COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION = 1 as const;

export type CollectionTriggerAuditMetadata = {
  readonly schemaVersion: typeof COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION;
  readonly runId: string;
};

type CollectionTriggerAuditMetadataView = Omit<
  CollectionTriggerAuditMetadata,
  'runId'
>;

function parseCollectionTriggerAuditMetadata(
  value: unknown,
): CollectionTriggerAuditMetadataView | null {
  return isJsonObject(value) &&
    value.schemaVersion === COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION &&
    typeof value.runId === 'string'
    ? { schemaVersion: COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION }
    : null;
}

export const SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION = 1 as const;

export type SubmissionFileCleanupAuditMetadata = {
  readonly schemaVersion: typeof SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION;
  readonly fileId: string;
};

function parseSubmissionFileCleanupAuditMetadata(
  value: unknown,
): SubmissionFileCleanupAuditMetadata | null {
  return isJsonObject(value) &&
    value.schemaVersion === SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION &&
    typeof value.fileId === 'string'
    ? {
        schemaVersion: SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION,
        fileId: value.fileId,
      }
    : null;
}

const ACCESS_AUDIT_SCHEMA_VERSION_V1 = 1 as const;

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

type AccessAuditMetadataView =
  | (Omit<AccessAuditMetadataV1, 'rejectionReason'> & {
      readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION_V1;
    })
  | (Omit<AccessAuditMetadataV2, 'rejectionReason'> & {
      readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION;
    });

function parseAccessAuditMetadata(
  value: unknown,
): AccessAuditMetadataView | null {
  if (!isAccessAuditMetadata(value)) return null;
  const base = {
    eventKind: value.eventKind,
    actor: personView(value.actor),
    before: accessStateView(value.before),
    after: accessStateView(value.after),
  };
  return value.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION
    ? {
        ...base,
        schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
        target: personView(value.target),
      }
    : { ...base, schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION_V1 };
}

function isAccessAuditMetadata(value: unknown): value is AccessAuditMetadata {
  if (
    !isJsonObject(value) ||
    !isPerson(value.actor) ||
    !isAccessState(value.before) ||
    !isAccessState(value.after)
  )
    return false;
  if (value.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION) {
    if (!isPerson(value.target)) return false;
  } else if (value.schemaVersion !== ACCESS_AUDIT_SCHEMA_VERSION_V1)
    return false;
  switch (value.eventKind) {
    case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED:
      return typeof value.rejectionReason === 'string';
    case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED:
    case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED:
    case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_RESTORED:
    case ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED:
    case ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED:
      return !('rejectionReason' in value);
    default:
      return false;
  }
}

function isPerson(value: unknown): value is AuditPersonSnapshot {
  return (
    isJsonObject(value) &&
    (typeof value.displayName === 'string' || value.displayName === null) &&
    typeof value.githubLogin === 'string'
  );
}

function isAccessState(value: unknown): value is AccessAuditState {
  return (
    isJsonObject(value) &&
    isRole(value.role) &&
    isAccountStatus(value.accountStatus) &&
    isRequestStatus(value.requestStatus)
  );
}

function isRole(value: unknown): value is AuthorityLabel | null {
  return (
    value === null ||
    value === 'STUDENT' ||
    value === 'STAFF' ||
    value === 'ADMIN'
  );
}

function isAccountStatus(value: unknown): value is AccountStatus {
  return value === AccountStatus.ACTIVE || value === AccountStatus.DEACTIVATED;
}

function isRequestStatus(
  value: unknown,
): value is StaffAccessRequestStatus | null {
  return (
    value === null ||
    Object.values(StaffAccessRequestStatus).some((status) => status === value)
  );
}

function personView(value: AuditPersonSnapshot): AuditPersonSnapshot {
  return { displayName: value.displayName, githubLogin: value.githubLogin };
}

function accessStateView(value: AccessAuditState): AccessAuditState {
  return {
    role: value.role,
    accountStatus: value.accountStatus,
    requestStatus: value.requestStatus,
  };
}

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

type ApplicationDecisionAuditMetadataView = ApplicationDecisionAuditMetadata;

function parseApplicationDecisionAuditMetadata(
  value: unknown,
): ApplicationDecisionAuditMetadataView | null {
  if (
    !isJsonObject(value) ||
    !isState(value.before) ||
    !isState(value.after) ||
    'rejectionReason' in value
  )
    return null;
  const base = {
    before: { status: value.before.status },
    after: { status: value.after.status },
  };
  if (value.schemaVersion === APPLICATION_DECISION_AUDIT_SCHEMA_VERSION) {
    return typeof value.programName === 'string' &&
      typeof value.applicantGithubLogin === 'string'
      ? {
          ...base,
          schemaVersion: APPLICATION_DECISION_AUDIT_SCHEMA_VERSION,
          programName: value.programName,
          applicantGithubLogin: value.applicantGithubLogin,
        }
      : null;
  }
  return value.schemaVersion === APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1
    ? {
        ...base,
        schemaVersion: APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1,
      }
    : null;
}

function isState(
  value: unknown,
): value is { readonly status: ApplicationStatus } {
  return (
    isJsonObject(value) &&
    Object.values(ApplicationStatus).some((status) => status === value.status)
  );
}

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

type IndependentAuthorityAuditCommand =
  (typeof INDEPENDENT_AUTHORITY_AUDIT_COMMANDS)[keyof typeof INDEPENDENT_AUTHORITY_AUDIT_COMMANDS];

const INDEPENDENT_AUTHORITY_AUDIT_METADATA_KEYS = [
  'schemaVersion',
  'eventKind',
  'command',
  'actor',
  'target',
  'before',
  'after',
] as const;

const AUDIT_PERSON_KEYS = ['displayName', 'githubLogin'] as const;

const INDEPENDENT_AUTHORITY_AUDIT_STATE_KEYS = [
  'memberKind',
  'hasStaffAccess',
  'hasAdminAccess',
  'role',
  'accountStatus',
] as const;

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

type IndependentAuthorityAuditMetadataView = IndependentAuthorityAuditMetadata;

function parseIndependentAuthorityAuditMetadata(
  value: unknown,
): IndependentAuthorityAuditMetadataView | null {
  if (!isIndependentAuthorityAuditMetadata(value)) return null;
  return {
    schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
    eventKind: ACCESS_AUDIT_EVENT_KINDS.INDEPENDENT_AUTHORITY_CHANGED,
    command: value.command,
    actor: personView(value.actor),
    target: personView(value.target),
    before: stateView(value.before),
    after: stateView(value.after),
  };
}

function isIndependentAuthorityAuditMetadata(
  value: unknown,
): value is IndependentAuthorityAuditMetadata {
  return (
    isJsonObject(value) &&
    hasExactKeys(value, INDEPENDENT_AUTHORITY_AUDIT_METADATA_KEYS) &&
    value.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION &&
    value.eventKind ===
      ACCESS_AUDIT_EVENT_KINDS.INDEPENDENT_AUTHORITY_CHANGED &&
    isCommand(value.command) &&
    isPersonForIndependentAuthorityAuditMetadata(value.actor) &&
    isPersonForIndependentAuthorityAuditMetadata(value.target) &&
    isStateForIndependentAuthorityAuditMetadata(value.before) &&
    isStateForIndependentAuthorityAuditMetadata(value.after)
  );
}

function isCommand(value: unknown): value is IndependentAuthorityAuditCommand {
  return Object.values(INDEPENDENT_AUTHORITY_AUDIT_COMMANDS).some(
    (command) => command === value,
  );
}

function isPersonForIndependentAuthorityAuditMetadata(
  value: unknown,
): value is AuditPersonSnapshot {
  return (
    isJsonObject(value) &&
    hasExactKeys(value, AUDIT_PERSON_KEYS) &&
    (typeof value.displayName === 'string' || value.displayName === null) &&
    typeof value.githubLogin === 'string'
  );
}

function isStateForIndependentAuthorityAuditMetadata(
  value: unknown,
): value is IndependentAuthorityAuditState {
  return (
    isJsonObject(value) &&
    hasExactKeys(value, INDEPENDENT_AUTHORITY_AUDIT_STATE_KEYS) &&
    (value.memberKind === null ||
      value.memberKind === MemberKind.STUDENT ||
      value.memberKind === MemberKind.STAFF) &&
    typeof value.hasStaffAccess === 'boolean' &&
    typeof value.hasAdminAccess === 'boolean' &&
    (value.role === null ||
      value.role === 'STUDENT' ||
      value.role === 'STAFF' ||
      value.role === 'ADMIN') &&
    (value.accountStatus === AccountStatus.ACTIVE ||
      value.accountStatus === AccountStatus.DEACTIVATED)
  );
}

function stateView(
  value: IndependentAuthorityAuditState,
): IndependentAuthorityAuditState {
  return {
    memberKind: value.memberKind,
    hasStaffAccess: value.hasStaffAccess,
    hasAdminAccess: value.hasAdminAccess,
    role: value.role,
    accountStatus: value.accountStatus,
  };
}

export const REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1 = 1 as const;

export const REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION = 2 as const;

type RepositoryPublishAuditVisibilityState = {
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

type RepositoryPublishAuditMetadataView = RepositoryPublishAuditMetadata;

function parseRepositoryPublishAuditMetadata(
  value: unknown,
): RepositoryPublishAuditMetadataView | null {
  if (
    !isJsonObject(value) ||
    typeof value.repositoryId !== 'string' ||
    !isVisibilityState(value.before) ||
    !isVisibilityState(value.after) ||
    typeof value.after.publishedAt !== 'string'
  )
    return null;
  const base = {
    repositoryId: value.repositoryId,
    before: { visibility: value.before.visibility },
    after: {
      visibility: value.after.visibility,
      publishedAt: value.after.publishedAt,
    },
  };
  if (value.schemaVersion === REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION) {
    return typeof value.repositoryFullName === 'string'
      ? {
          ...base,
          schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION,
          repositoryFullName: value.repositoryFullName,
        }
      : null;
  }
  return value.schemaVersion === REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1
    ? { ...base, schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1 }
    : null;
}

function isVisibilityState(
  value: unknown,
): value is RepositoryPublishAuditVisibilityState & {
  readonly publishedAt?: string;
} {
  return (
    isJsonObject(value) &&
    (value.visibility === RepositoryVisibility.PRIVATE ||
      value.visibility === RepositoryVisibility.PUBLIC)
  );
}

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

type ProgramLifecycleAuditMetadataView = ProgramLifecycleAuditMetadata;

function parseProgramLifecycleAuditMetadata(
  value: unknown,
): ProgramLifecycleAuditMetadataView | null {
  if (
    !isJsonObject(value) ||
    !isLifecycleState(value.before) ||
    !isLifecycleState(value.after)
  )
    return null;
  const base = {
    before: { lifecycle: value.before.lifecycle },
    after: { lifecycle: value.after.lifecycle },
  };
  if (value.schemaVersion === PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION) {
    return typeof value.programName === 'string'
      ? {
          ...base,
          schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION,
          programName: value.programName,
        }
      : null;
  }
  return value.schemaVersion === PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1
    ? { ...base, schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1 }
    : null;
}

function isLifecycleState(
  value: unknown,
): value is { readonly lifecycle: ProgramLifecycle } {
  return (
    isJsonObject(value) &&
    (value.lifecycle === ProgramLifecycle.PUBLISHED ||
      value.lifecycle === ProgramLifecycle.ARCHIVED)
  );
}

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

type ProgramDeletionAuditMetadataView = ProgramDeletionAuditMetadata;

function parseProgramDeletionAuditMetadata(
  value: unknown,
): ProgramDeletionAuditMetadataView | null {
  if (
    !isJsonObject(value) ||
    value.schemaVersion !== PROGRAM_DELETION_AUDIT_SCHEMA_VERSION ||
    typeof value.programName !== 'string' ||
    !isLifecycle(value.lifecycle) ||
    !isBlockingCounts(value.blockingCounts)
  )
    return null;
  return {
    schemaVersion: PROGRAM_DELETION_AUDIT_SCHEMA_VERSION,
    programName: value.programName,
    lifecycle: value.lifecycle,
    blockingCounts: { ...value.blockingCounts },
  };
}

function isLifecycle(value: unknown): value is ProgramLifecycle {
  return (
    value === ProgramLifecycle.PUBLISHED || value === ProgramLifecycle.ARCHIVED
  );
}

function isBlockingCounts(
  value: unknown,
): value is ProgramDeletionAuditBlockingCounts {
  return (
    isJsonObject(value) &&
    typeof value.applications === 'number' &&
    typeof value.teams === 'number' &&
    typeof value.submissions === 'number' &&
    typeof value.boardPosts === 'number'
  );
}

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

type UserProfileAuditMetadataView =
  UserProfileAuditMetadata | UserPhoneAuditMetadata;

const USER_PROFILE_AUDIT_METADATA_KEYS = [
  'schemaVersion',
  'actor',
  'target',
  'changes',
] as const;

const USER_PHONE_AUDIT_METADATA_KEYS = [
  'schemaVersion',
  'actor',
  'target',
  'transition',
] as const;

const USER_PROFILE_AUDIT_FIELD_CHANGE_KEYS = [
  'field',
  'before',
  'after',
] as const;

function parseUserProfileAuditMetadata(
  value: unknown,
): UserProfileAuditMetadataView | null {
  if (
    isJsonObject(value) &&
    hasExactKeys(value, USER_PHONE_AUDIT_METADATA_KEYS) &&
    value.schemaVersion === USER_PROFILE_AUDIT_SCHEMA_VERSION &&
    isPersonForUserProfileAuditMetadata(value.actor) &&
    isPersonForUserProfileAuditMetadata(value.target) &&
    isPhoneTransition(value.transition)
  ) {
    return {
      schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION,
      actor: personViewForUserProfileAuditMetadata(value.actor),
      target: personViewForUserProfileAuditMetadata(value.target),
      transition: value.transition,
    };
  }
  if (
    !isJsonObject(value) ||
    !hasExactKeys(value, USER_PROFILE_AUDIT_METADATA_KEYS) ||
    value.schemaVersion !== USER_PROFILE_AUDIT_SCHEMA_VERSION ||
    !isPersonForUserProfileAuditMetadata(value.actor) ||
    !isPersonForUserProfileAuditMetadata(value.target) ||
    !Array.isArray(value.changes) ||
    !value.changes.every(isFieldChange)
  )
    return null;
  return {
    schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION,
    actor: personViewForUserProfileAuditMetadata(value.actor),
    target: personViewForUserProfileAuditMetadata(value.target),
    changes: value.changes.map((change) => ({ ...change })),
  };
}

function isPersonForUserProfileAuditMetadata(
  value: unknown,
): value is AuditActorSnapshot {
  return (
    isJsonObject(value) &&
    hasExactKeys(value, AUDIT_PERSON_KEYS) &&
    (typeof value.displayName === 'string' || value.displayName === null) &&
    typeof value.githubLogin === 'string'
  );
}

function isFieldChange(value: unknown): value is UserProfileAuditFieldChange {
  return (
    isJsonObject(value) &&
    hasExactKeys(value, USER_PROFILE_AUDIT_FIELD_CHANGE_KEYS) &&
    Object.values(USER_PROFILE_AUDIT_FIELDS).some(
      (field) => field === value.field,
    ) &&
    (typeof value.before === 'string' || value.before === null) &&
    (typeof value.after === 'string' || value.after === null)
  );
}

function isPhoneTransition(value: unknown): value is UserPhoneAuditTransition {
  return Object.values(USER_PHONE_AUDIT_TRANSITIONS).some(
    (transition) => transition === value,
  );
}

function personViewForUserProfileAuditMetadata(
  value: AuditActorSnapshot,
): AuditActorSnapshot {
  return { displayName: value.displayName, githubLogin: value.githubLogin };
}

export const PROGRAM_CREATED_AUDIT_SCHEMA_VERSION = 1 as const;

export type ProgramCreatedAuditMetadata = {
  readonly schemaVersion: typeof PROGRAM_CREATED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
};

type ProgramCreatedAuditMetadataView = ProgramCreatedAuditMetadata;

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

type TeamMembershipAuditOperation =
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

type TeamRenamedAuditMetadataView = TeamRenamedAuditMetadata;

export const TEAM_DELETED_AUDIT_SCHEMA_VERSION = 1 as const;

type TeamDeletedAuditCounts = {
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

type TeamDeletedAuditMetadataView = TeamDeletedAuditMetadata;

const TEAM_DELETED_COUNT_KEYS = [
  'applications',
  'members',
  'invitations',
  'submissions',
  'submissionEvents',
  'detachedRepositories',
] as const;

const FORBIDDEN_KEYS = [
  'answers',
  'joinCode',
  'joinCodeDigest',
  'name',
  'studentId',
  'email',
  'rejectionReason',
  'applicantGithubLogin',
  'target',
] as const;

const TEAM_MEMBERSHIP_RESERVED_KEYS = [
  'operation',
  'removedUserId',
  'previousLeaderId',
  'nextLeaderId',
] as const;

const TEAM_RENAMED_RESERVED_KEYS = ['previousName'] as const;

const TEAM_DELETED_RESERVED_KEYS = ['deletedCounts'] as const;

function parseTeamDeletedAuditMetadata(
  value: unknown,
): TeamDeletedAuditMetadataView | null {
  if (!isTeamStateShape(value, TEAM_DELETED_AUDIT_SCHEMA_VERSION)) {
    return null;
  }
  const { deletedCounts } = value;
  if (!isTeamDeletedCounts(deletedCounts)) return null;

  return {
    schemaVersion: TEAM_DELETED_AUDIT_SCHEMA_VERSION,
    programName: value.programName,
    teamName: value.teamName,
    deletedCounts,
  };
}

function isTeamDeletedCounts(value: unknown): value is TeamDeletedAuditCounts {
  if (!isJsonObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === TEAM_DELETED_COUNT_KEYS.length &&
    TEAM_DELETED_COUNT_KEYS.every((key) => Number.isInteger(value[key]))
  );
}

function parseTeamRenamedAuditMetadata(
  value: unknown,
): TeamRenamedAuditMetadataView | null {
  if (!isTeamStateShape(value, TEAM_RENAMED_AUDIT_SCHEMA_VERSION)) {
    return null;
  }
  const { previousName } = value;

  return typeof previousName === 'string'
    ? {
        schemaVersion: TEAM_RENAMED_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
        teamName: value.teamName,
        previousName,
      }
    : null;
}

export function parseTeamMembershipAuditMetadata(
  value: unknown,
): TeamMembershipAuditMetadataView | null {
  if (!isTeamStateShape(value, TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION)) {
    return null;
  }
  const { operation, removedUserId, previousLeaderId, nextLeaderId } = value;

  return isTeamMembershipOperation(operation) &&
    hasValidRemovedUserId(operation, removedUserId) &&
    typeof previousLeaderId === 'string' &&
    (nextLeaderId === null || typeof nextLeaderId === 'string')
    ? {
        schemaVersion: TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
        teamName: value.teamName,
        operation,
        removedUserId,
        previousLeaderId,
        nextLeaderId,
      }
    : null;
}

function parseProgramCreatedAuditMetadata(
  value: unknown,
): ProgramCreatedAuditMetadataView | null {
  return isBase(value, PROGRAM_CREATED_AUDIT_SCHEMA_VERSION) &&
    !('teamName' in value) &&
    !('lifecycle' in value) &&
    !('blockingCounts' in value) &&
    !('before' in value) &&
    !('after' in value)
    ? {
        schemaVersion: PROGRAM_CREATED_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
      }
    : null;
}

export function parseTeamCreatedAuditMetadata(
  value: unknown,
): TeamCreatedAuditMetadataView | null {
  return isTeamState(value, TEAM_CREATED_AUDIT_SCHEMA_VERSION)
    ? {
        schemaVersion: TEAM_CREATED_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
        teamName: value.teamName,
      }
    : null;
}

export function parseTeamJoinedAuditMetadata(
  value: unknown,
): TeamJoinedAuditMetadataView | null {
  return isTeamState(value, TEAM_JOINED_AUDIT_SCHEMA_VERSION)
    ? {
        schemaVersion: TEAM_JOINED_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
        teamName: value.teamName,
      }
    : null;
}

export function parseApplicationSubmittedAuditMetadata(
  value: unknown,
): ApplicationSubmittedAuditMetadataView | null {
  return isTeamState(value, APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION) &&
    !('applicantGithubLogin' in value)
    ? {
        schemaVersion: APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION,
        programName: value.programName,
        teamName: value.teamName,
      }
    : null;
}

function isTeamState(
  value: unknown,
  schemaVersion: number,
): value is Record<string, unknown> & {
  readonly programName: string;
  readonly teamName: string;
} {
  return (
    isTeamStateShape(value, schemaVersion) &&
    !TEAM_MEMBERSHIP_RESERVED_KEYS.some((key) => key in value) &&
    !TEAM_RENAMED_RESERVED_KEYS.some((key) => key in value) &&
    !TEAM_DELETED_RESERVED_KEYS.some((key) => key in value)
  );
}

function isTeamStateShape(
  value: unknown,
  schemaVersion: number,
): value is Record<string, unknown> & {
  readonly programName: string;
  readonly teamName: string;
} {
  return isBase(value, schemaVersion) && typeof value.teamName === 'string';
}

function hasValidRemovedUserId(
  operation: TeamMembershipAuditOperation,
  removedUserId: unknown,
): removedUserId is string | null {
  return operation === TEAM_MEMBERSHIP_AUDIT_OPERATIONS.TRANSFER_LEADER
    ? removedUserId === null
    : typeof removedUserId === 'string';
}

function isTeamMembershipOperation(
  value: unknown,
): value is TeamMembershipAuditOperation {
  return (
    value === TEAM_MEMBERSHIP_AUDIT_OPERATIONS.LEAVE ||
    value === TEAM_MEMBERSHIP_AUDIT_OPERATIONS.REMOVE ||
    value === TEAM_MEMBERSHIP_AUDIT_OPERATIONS.TRANSFER_LEADER
  );
}

function isBase(
  value: unknown,
  schemaVersion: number,
): value is Record<string, unknown> & { readonly programName: string } {
  return (
    isJsonObject(value) &&
    value.schemaVersion === schemaVersion &&
    typeof value.programName === 'string' &&
    !FORBIDDEN_KEYS.some((key) => key in value)
  );
}

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

export function parseAuditLogMetadata(
  value: unknown,
): AuditLogMetadataEvidence {
  if (isJsonObject(value) && Object.keys(value).length === 0) {
    return { legacy: true, metadata: null };
  }
  const metadata = parseKnownAuditLogMetadata(value);

  if (!metadata) {
    throw new InvalidAuditLogMetadataError();
  }

  return { legacy: false, metadata };
}

function parseKnownAuditLogMetadata(
  value: unknown,
): AuditLogMetadataView | null {
  return (
    parseApplicationRepositoryUrlAuditMetadata(value) ??
    parseIndependentAuthorityAuditMetadata(value) ??
    parseAccessAuditMetadata(value) ??
    parseRepositoryConnectionAuditMetadata(value) ??
    parseRepositoryPublishAuditMetadata(value) ??
    parseProgramLifecycleAuditMetadata(value) ??
    parseProgramDeletionAuditMetadata(value) ??
    parseTeamMembershipAuditMetadata(value) ??
    parseTeamRenamedAuditMetadata(value) ??
    parseTeamDeletedAuditMetadata(value) ??
    parseTeamCreatedAuditMetadata(value) ??
    parseTeamJoinedAuditMetadata(value) ??
    parseApplicationSubmittedAuditMetadata(value) ??
    parseProgramCreatedAuditMetadata(value) ??
    parseCollectionTriggerAuditMetadata(value) ??
    parseSubmissionFileCleanupAuditMetadata(value) ??
    parseApplicationDecisionAuditMetadata(value) ??
    parseUserProfileAuditMetadata(value)
  );
}

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
