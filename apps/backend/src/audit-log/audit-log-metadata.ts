import {
  AccountStatus,
  ProgramLifecycle,
  RepositoryVisibility,
  Role,
  RoleRequestStatus,
} from '@prisma/client';

export const ACCESS_AUDIT_SCHEMA_VERSION_V1 = 1 as const;
export const ACCESS_AUDIT_SCHEMA_VERSION = 2 as const;

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

// 이벤트 시점에 관측한 사람(행위자 또는 대상)의 표시 이름·GitHub 로그인 스냅샷이다.
// 조회 시점에 User를 다시 조회해 재계산하지 않는다(개명·탈퇴 이후에도 원본 로그를 보존).
export type AuditPersonSnapshot = {
  readonly displayName: string | null;
  readonly githubLogin: string;
};

export type AuditActorSnapshot = AuditPersonSnapshot;
export type AuditTargetSnapshot = AuditPersonSnapshot;

export type AccessAuditState = {
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly requestStatus: RoleRequestStatus | null;
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
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED;
    })
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED;
      readonly rejectionReason: string;
    })
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED;
    })
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_RESTORED;
    })
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED;
    })
  | (Base & {
      readonly eventKind: typeof ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED;
    });

// schemaVersion 1: 액터 스냅샷만 있고 대상은 targetType/targetId로만 식별된 과거 행이다.
// 절대 다시 쓰지 않는다 — append-only 원장이므로 이 버전은 읽기 호환 목적으로만 남는다.
export type AccessAuditMetadataV1 =
  AccessAuditEventUnion<AccessAuditMetadataBaseV1>;

// schemaVersion 2: 액터·대상 모두 이벤트 시점 스냅샷을 기록한다(PR02 target 보강분).
export type AccessAuditMetadataV2 =
  AccessAuditEventUnion<AccessAuditMetadataBaseV2>;

export type AccessAuditMetadata = AccessAuditMetadataV1 | AccessAuditMetadataV2;

type DistributiveOmit<T, Key extends PropertyKey> = T extends T
  ? Omit<T, Key>
  : never;

// 새 행은 항상 최신 스키마 버전으로 쓴다.
export type AccessAuditMetadataInput = DistributiveOmit<
  AccessAuditMetadataV2,
  'schemaVersion'
>;

/**
 * todo 20 — repository 수동 공개 typed audit의 최소 정의. 전체 action registry(#action
 * 카탈로그·문서화 등)는 todo 21 소관이라 여기서는 이 한 번의 write에 필요한 타입만 둔다.
 * 실명·studentId·email 등 금지 필드는 담지 않는다 — actor는 `AuditLog.actorId` FK로 이미
 * 식별되므로 metadata에 다시 스냅샷하지 않는다.
 */
export const REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION = 1 as const;

export const REPOSITORY_PUBLISH_AUDIT_ACTIONS = {
  REPOSITORY_PUBLISHED: 'REPOSITORY_PUBLISHED',
} as const;

export type RepositoryPublishAuditAction =
  (typeof REPOSITORY_PUBLISH_AUDIT_ACTIONS)[keyof typeof REPOSITORY_PUBLISH_AUDIT_ACTIONS];

export type RepositoryPublishAuditVisibilityState = {
  readonly visibility: RepositoryVisibility;
};

export type RepositoryPublishAuditMetadata = {
  readonly schemaVersion: typeof REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION;
  readonly repositoryId: string;
  readonly before: RepositoryPublishAuditVisibilityState;
  readonly after: RepositoryPublishAuditVisibilityState & {
    readonly publishedAt: string;
  };
};

export type RepositoryPublishAuditMetadataInput = DistributiveOmit<
  RepositoryPublishAuditMetadata,
  'schemaVersion'
>;

export function createRepositoryPublishAuditMetadata(
  input: RepositoryPublishAuditMetadataInput,
): RepositoryPublishAuditMetadata {
  return { schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION, ...input };
}

export const PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION = 1 as const;

export const PROGRAM_LIFECYCLE_AUDIT_ACTIONS = {
  PROGRAM_ARCHIVED: 'PROGRAM_ARCHIVED',
  PROGRAM_RESTORED: 'PROGRAM_RESTORED',
} as const;

export type ProgramLifecycleAuditMetadata = {
  readonly schemaVersion: typeof PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION;
  readonly before: { readonly lifecycle: ProgramLifecycle };
  readonly after: { readonly lifecycle: ProgramLifecycle };
};

export function createProgramLifecycleAuditMetadata(
  input: Omit<ProgramLifecycleAuditMetadata, 'schemaVersion'>,
): ProgramLifecycleAuditMetadata {
  return { schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION, ...input };
}

export type AuditLogMetadata =
  | AccessAuditMetadata
  | RepositoryPublishAuditMetadata
  | ProgramLifecycleAuditMetadata;

export type AuditLogMetadataEvidence =
  | { readonly legacy: true; readonly metadata: null }
  | { readonly legacy: false; readonly metadata: AuditLogMetadata };

export class InvalidAuditLogMetadataError extends Error {
  constructor() {
    super('Audit log metadata does not match a known audit schema version.');
    this.name = 'InvalidAuditLogMetadataError';
  }
}

export function createAccessAuditMetadata(
  input: AccessAuditMetadataInput,
): AccessAuditMetadataV2 {
  return { schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION, ...input };
}

export function parseAuditLogMetadata(
  value: unknown,
): AuditLogMetadataEvidence {
  if (isJsonObject(value) && Object.keys(value).length === 0) {
    return { legacy: true, metadata: null };
  }
  if (
    isAccessAuditMetadata(value) ||
    isRepositoryPublishAuditMetadata(value) ||
    isProgramLifecycleAuditMetadata(value)
  ) {
    return { legacy: false, metadata: value };
  }
  throw new InvalidAuditLogMetadataError();
}

function isRepositoryPublishAuditMetadata(
  value: unknown,
): value is RepositoryPublishAuditMetadata {
  return (
    isJsonObject(value) &&
    value.schemaVersion === REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION &&
    typeof value.repositoryId === 'string' &&
    isRepositoryPublishAuditVisibilityState(value.before) &&
    isRepositoryPublishAuditVisibilityState(value.after) &&
    typeof (value.after as { publishedAt?: unknown }).publishedAt === 'string'
  );
}

function isRepositoryPublishAuditVisibilityState(
  value: unknown,
): value is RepositoryPublishAuditVisibilityState {
  return (
    isJsonObject(value) &&
    (value.visibility === RepositoryVisibility.PRIVATE ||
      value.visibility === RepositoryVisibility.PUBLIC)
  );
}
function isProgramLifecycleAuditMetadata(
  value: unknown,
): value is ProgramLifecycleAuditMetadata {
  return (
    isJsonObject(value) &&
    value.schemaVersion === PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION &&
    isProgramLifecycleState(value.before) &&
    isProgramLifecycleState(value.after)
  );
}

function isProgramLifecycleState(
  value: unknown,
): value is { readonly lifecycle: ProgramLifecycle } {
  return (
    isJsonObject(value) &&
    (value.lifecycle === ProgramLifecycle.PUBLISHED ||
      value.lifecycle === ProgramLifecycle.ARCHIVED)
  );
}

function isAccessAuditMetadata(value: unknown): value is AccessAuditMetadata {
  if (
    !isJsonObject(value) ||
    !isAuditPersonSnapshot(value.actor) ||
    !isAccessAuditState(value.before) ||
    !isAccessAuditState(value.after)
  ) {
    return false;
  }
  if (value.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION) {
    if (!isAuditPersonSnapshot(value.target)) {
      return false;
    }
  } else if (value.schemaVersion !== ACCESS_AUDIT_SCHEMA_VERSION_V1) {
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

function isAuditPersonSnapshot(value: unknown): value is AuditPersonSnapshot {
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
