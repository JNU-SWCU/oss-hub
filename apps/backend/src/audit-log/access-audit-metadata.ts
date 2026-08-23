import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import type { AuthorityLabel } from '../common/authority-label';
import { isJsonObject } from './audit-metadata-validation';

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

export type AccessAuditEventKind =
  (typeof ACCESS_AUDIT_EVENT_KINDS)[keyof typeof ACCESS_AUDIT_EVENT_KINDS];
export type AccessAuditAction =
  (typeof ACCESS_AUDIT_ACTIONS)[keyof typeof ACCESS_AUDIT_ACTIONS];

export type AuditPersonSnapshot = {
  readonly displayName: string | null;
  readonly githubLogin: string;
};
export type AuditActorSnapshot = AuditPersonSnapshot;
export type AuditTargetSnapshot = AuditPersonSnapshot;

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

export type AccessAuditMetadataV1 =
  AccessAuditEventUnion<AccessAuditMetadataBaseV1>;
export type AccessAuditMetadataV2 =
  AccessAuditEventUnion<AccessAuditMetadataBaseV2>;
export type AccessAuditMetadata = AccessAuditMetadataV1 | AccessAuditMetadataV2;
type DistributiveOmit<T, Key extends PropertyKey> = T extends T
  ? Omit<T, Key>
  : never;
export type AccessAuditMetadataInput = DistributiveOmit<
  AccessAuditMetadataV2,
  'schemaVersion'
>;

export type AccessAuditMetadataView =
  | (Omit<AccessAuditMetadataV1, 'rejectionReason'> & {
      readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION_V1;
    })
  | (Omit<AccessAuditMetadataV2, 'rejectionReason'> & {
      readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION;
    });
export function createAccessAuditMetadata(
  input: AccessAuditMetadataInput,
): AccessAuditMetadataV2 {
  return { schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION, ...input };
}

export function parseAccessAuditMetadata(
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
