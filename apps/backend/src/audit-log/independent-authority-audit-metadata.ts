import { AccountStatus, MemberKind } from '@prisma/client';
import type { AuthorityLabel } from '../users/domain/authority-label';
import {
  ACCESS_AUDIT_EVENT_KINDS,
  ACCESS_AUDIT_SCHEMA_VERSION,
  type AuditActorSnapshot,
  type AuditPersonSnapshot,
  type AuditTargetSnapshot,
} from './access-audit-metadata';
import { hasExactKeys, isJsonObject } from './audit-metadata-validation';

export const INDEPENDENT_AUTHORITY_AUDIT_COMMANDS = {
  GRANT_STAFF_ACCESS: 'GRANT_STAFF_ACCESS',
  REVOKE_STAFF_ACCESS: 'REVOKE_STAFF_ACCESS',
  GRANT_ADMIN_ACCESS: 'GRANT_ADMIN_ACCESS',
  REVOKE_ADMIN_ACCESS: 'REVOKE_ADMIN_ACCESS',
} as const;
export const INDEPENDENT_AUTHORITY_AUDIT_ACTIONS =
  INDEPENDENT_AUTHORITY_AUDIT_COMMANDS;
export type IndependentAuthorityAuditCommand =
  (typeof INDEPENDENT_AUTHORITY_AUDIT_COMMANDS)[keyof typeof INDEPENDENT_AUTHORITY_AUDIT_COMMANDS];
export type IndependentAuthorityAuditAction =
  (typeof INDEPENDENT_AUTHORITY_AUDIT_ACTIONS)[keyof typeof INDEPENDENT_AUTHORITY_AUDIT_ACTIONS];

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
export type IndependentAuthorityAuditMetadataInput = Omit<
  IndependentAuthorityAuditMetadata,
  'schemaVersion' | 'eventKind'
>;
export type IndependentAuthorityAuditMetadataView =
  IndependentAuthorityAuditMetadata;

export function createIndependentAuthorityAuditMetadata(
  input: IndependentAuthorityAuditMetadataInput,
): IndependentAuthorityAuditMetadata {
  return {
    schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
    eventKind: ACCESS_AUDIT_EVENT_KINDS.INDEPENDENT_AUTHORITY_CHANGED,
    ...input,
  };
}

export function parseIndependentAuthorityAuditMetadata(
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
    isPerson(value.actor) &&
    isPerson(value.target) &&
    isState(value.before) &&
    isState(value.after)
  );
}

function isCommand(value: unknown): value is IndependentAuthorityAuditCommand {
  return Object.values(INDEPENDENT_AUTHORITY_AUDIT_COMMANDS).some(
    (command) => command === value,
  );
}
function isPerson(value: unknown): value is AuditPersonSnapshot {
  return (
    isJsonObject(value) &&
    hasExactKeys(value, AUDIT_PERSON_KEYS) &&
    (typeof value.displayName === 'string' || value.displayName === null) &&
    typeof value.githubLogin === 'string'
  );
}
function isState(value: unknown): value is IndependentAuthorityAuditState {
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
function personView(value: AuditPersonSnapshot): AuditPersonSnapshot {
  return { displayName: value.displayName, githubLogin: value.githubLogin };
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
