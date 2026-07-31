import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';

export const ACCESS_AUDIT_SCHEMA_VERSION = 1 as const;

export const ACCESS_AUDIT_EVENT_KINDS = {
  ROLE_REQUEST_APPROVED: 'ROLE_REQUEST_APPROVED',
  ROLE_REQUEST_REJECTED: 'ROLE_REQUEST_REJECTED',
  ROLE_REQUEST_REVOKED: 'ROLE_REQUEST_REVOKED',
  ROLE_REQUEST_RESTORED: 'ROLE_REQUEST_RESTORED',
  DIRECT_ROLE_CHANGED: 'DIRECT_ROLE_CHANGED',
  ACCOUNT_STATUS_CHANGED: 'ACCOUNT_STATUS_CHANGED',
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

export type AuditActorSnapshot = {
  readonly displayName: string | null;
  readonly githubLogin: string;
};

export type AccessAuditState = {
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly requestStatus: RoleRequestStatus | null;
};

type AccessAuditMetadataBase = {
  readonly schemaVersion: typeof ACCESS_AUDIT_SCHEMA_VERSION;
  readonly actor: AuditActorSnapshot;
  readonly before: AccessAuditState;
  readonly after: AccessAuditState;
};

export type AccessAuditMetadata =
  | (AccessAuditMetadataBase & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED;
    })
  | (AccessAuditMetadataBase & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED;
      readonly rejectionReason: string;
    })
  | (AccessAuditMetadataBase & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED;
    })
  | (AccessAuditMetadataBase & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_RESTORED;
    })
  | (AccessAuditMetadataBase & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED;
    })
  | (AccessAuditMetadataBase & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED;
    });

type DistributiveOmit<T, Key extends PropertyKey> = T extends T
  ? Omit<T, Key>
  : never;

export type AccessAuditMetadataInput = DistributiveOmit<
  AccessAuditMetadata,
  'schemaVersion'
>;

export type AuditLogMetadataEvidence =
  | { readonly legacy: true; readonly metadata: null }
  | { readonly legacy: false; readonly metadata: AccessAuditMetadata };

export class InvalidAuditLogMetadataError extends Error {
  constructor() {
    super('Audit log metadata does not match access-audit schema version 1.');
    this.name = 'InvalidAuditLogMetadataError';
  }
}

export function createAccessAuditMetadata(
  input: AccessAuditMetadataInput,
): AccessAuditMetadata {
  return { schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION, ...input };
}

export function parseAuditLogMetadata(
  value: unknown,
): AuditLogMetadataEvidence {
  if (isJsonObject(value) && Object.keys(value).length === 0) {
    return { legacy: true, metadata: null };
  }
  if (!isAccessAuditMetadata(value)) {
    throw new InvalidAuditLogMetadataError();
  }
  return { legacy: false, metadata: value };
}

function isAccessAuditMetadata(value: unknown): value is AccessAuditMetadata {
  if (
    !isJsonObject(value) ||
    value.schemaVersion !== ACCESS_AUDIT_SCHEMA_VERSION ||
    !isAuditActorSnapshot(value.actor) ||
    !isAccessAuditState(value.before) ||
    !isAccessAuditState(value.after)
  ) {
    return false;
  }

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

function isAuditActorSnapshot(value: unknown): value is AuditActorSnapshot {
  return (
    isJsonObject(value) &&
    (typeof value.displayName === 'string' || value.displayName === null) &&
    typeof value.githubLogin === 'string'
  );
}

function isAccessAuditState(value: unknown): value is AccessAuditState {
  return (
    isJsonObject(value) &&
    isRole(value.role) &&
    isAccountStatus(value.accountStatus) &&
    isRoleRequestStatus(value.requestStatus)
  );
}

function isRole(value: unknown): value is Role | null {
  return (
    value === null ||
    value === Role.STUDENT ||
    value === Role.STAFF ||
    value === Role.ADMIN
  );
}

function isAccountStatus(value: unknown): value is AccountStatus {
  return value === AccountStatus.ACTIVE || value === AccountStatus.DEACTIVATED;
}

function isRoleRequestStatus(
  value: unknown,
): value is RoleRequestStatus | null {
  return (
    value === null ||
    value === RoleRequestStatus.PENDING ||
    value === RoleRequestStatus.APPROVED ||
    value === RoleRequestStatus.REJECTED ||
    value === RoleRequestStatus.REVOKED
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
