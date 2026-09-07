import type {
  AuditActorSnapshot,
  AuditTargetSnapshot,
} from './access-audit-metadata';
import { hasExactKeys, isJsonObject } from './audit-metadata-validation';

export const USER_PROFILE_AUDIT_SCHEMA_VERSION = 1 as const;
export const USER_PROFILE_AUDIT_ACTIONS = {
  PROFILE_UPDATED: 'USER_PROFILE_UPDATED',
  PHONE_UPDATED: 'USER_PHONE_UPDATED',
} as const;
export type UserProfileAuditAction =
  (typeof USER_PROFILE_AUDIT_ACTIONS)[keyof typeof USER_PROFILE_AUDIT_ACTIONS];
export const USER_PROFILE_AUDIT_FIELDS = {
  NAME: 'name',
  STUDENT_ID: 'studentId',
  DEPARTMENT: 'department',
} as const;
export type UserProfileAuditFieldName =
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
const AUDIT_PERSON_KEYS = ['displayName', 'githubLogin'] as const;
const USER_PROFILE_AUDIT_FIELD_CHANGE_KEYS = [
  'field',
  'before',
  'after',
] as const;

export function createUserProfileAuditMetadata(
  input: Omit<UserProfileAuditMetadata, 'schemaVersion'>,
): UserProfileAuditMetadata {
  return { schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION, ...input };
}

export function createUserPhoneAuditMetadata(
  input: Omit<UserPhoneAuditMetadata, 'schemaVersion'>,
): UserPhoneAuditMetadata {
  return { schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION, ...input };
}

export function parseUserProfileAuditMetadata(
  value: unknown,
): UserProfileAuditMetadataView | null {
  if (
    isJsonObject(value) &&
    hasExactKeys(value, USER_PHONE_AUDIT_METADATA_KEYS) &&
    value.schemaVersion === USER_PROFILE_AUDIT_SCHEMA_VERSION &&
    isPerson(value.actor) &&
    isPerson(value.target) &&
    isPhoneTransition(value.transition)
  ) {
    return {
      schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION,
      actor: personView(value.actor),
      target: personView(value.target),
      transition: value.transition,
    };
  }
  if (
    !isJsonObject(value) ||
    !hasExactKeys(value, USER_PROFILE_AUDIT_METADATA_KEYS) ||
    value.schemaVersion !== USER_PROFILE_AUDIT_SCHEMA_VERSION ||
    !isPerson(value.actor) ||
    !isPerson(value.target) ||
    !Array.isArray(value.changes) ||
    !value.changes.every(isFieldChange)
  )
    return null;
  return {
    schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION,
    actor: personView(value.actor),
    target: personView(value.target),
    changes: value.changes.map((change) => ({ ...change })),
  };
}

function isPerson(value: unknown): value is AuditActorSnapshot {
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
function personView(value: AuditActorSnapshot): AuditActorSnapshot {
  return { displayName: value.displayName, githubLogin: value.githubLogin };
}
