import {
  ProgramLifecycle,
  RepositoryConnectionMode,
  RepositoryVisibility,
} from '@prisma/client';
import { isJsonObject } from './audit-metadata-validation';

export const REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1 = 1 as const;
export const REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION = 2 as const;
export const REPOSITORY_PUBLISH_AUDIT_ACTIONS = {
  REPOSITORY_PUBLISHED: 'REPOSITORY_PUBLISHED',
} as const;
export type RepositoryPublishAuditAction =
  (typeof REPOSITORY_PUBLISH_AUDIT_ACTIONS)[keyof typeof REPOSITORY_PUBLISH_AUDIT_ACTIONS];
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
export type RepositoryPublishAuditMetadataV1 =
  RepositoryPublishAuditMetadataBaseV1;
export type RepositoryPublishAuditMetadataV2 =
  RepositoryPublishAuditMetadataBaseV2;
export type RepositoryPublishAuditMetadata =
  RepositoryPublishAuditMetadataV1 | RepositoryPublishAuditMetadataV2;
export type RepositoryPublishAuditMetadataInput = Omit<
  RepositoryPublishAuditMetadataV2,
  'schemaVersion'
>;
export type RepositoryPublishAuditMetadataView = RepositoryPublishAuditMetadata;

export function createRepositoryPublishAuditMetadata(
  input: RepositoryPublishAuditMetadataInput,
): RepositoryPublishAuditMetadataV2 {
  return { schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION, ...input };
}

const GITHUB_REPOSITORY_URL_PATTERN =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/?$/;
export function deriveRepositoryFullName(name: string, url: string): string {
  const match = GITHUB_REPOSITORY_URL_PATTERN.exec(url);
  return match ? `${match[1]}/${match[2]}` : name;
}

export function parseRepositoryPublishAuditMetadata(
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

export const REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION = 1 as const;
export const REPOSITORY_CONNECTION_AUDIT_ACTIONS = {
  REPOSITORY_CONNECTION_CHANGED: 'REPOSITORY_CONNECTION_CHANGED',
} as const;

export type RepositoryConnectionAuditState = {
  readonly repositoryId: string | null;
  readonly nameWithOwner: string | null;
  readonly connectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
};

export type RepositoryConnectionAuditMetadata = {
  readonly schemaVersion: typeof REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION;
  readonly applicationId: string;
  readonly before: RepositoryConnectionAuditState;
  readonly after: RepositoryConnectionAuditState;
};

export type RepositoryConnectionAuditMetadataView =
  RepositoryConnectionAuditMetadata;

export function createRepositoryConnectionAuditMetadata(
  input: Omit<RepositoryConnectionAuditMetadata, 'schemaVersion'>,
): RepositoryConnectionAuditMetadata {
  return {
    schemaVersion: REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}

export function parseRepositoryConnectionAuditMetadata(
  value: unknown,
): RepositoryConnectionAuditMetadataView | null {
  if (
    !isJsonObject(value) ||
    value.schemaVersion !== REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION ||
    typeof value.applicationId !== 'string' ||
    !isRepositoryConnectionState(value.before) ||
    !isRepositoryConnectionState(value.after)
  ) {
    return null;
  }
  return {
    schemaVersion: REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION,
    applicationId: value.applicationId,
    before: {
      repositoryId: value.before.repositoryId,
      nameWithOwner: value.before.nameWithOwner,
      connectionMode: value.before.connectionMode,
      repositoryUrl: value.before.repositoryUrl,
    },
    after: {
      repositoryId: value.after.repositoryId,
      nameWithOwner: value.after.nameWithOwner,
      connectionMode: value.after.connectionMode,
      repositoryUrl: value.after.repositoryUrl,
    },
  };
}

function isRepositoryConnectionState(
  value: unknown,
): value is RepositoryConnectionAuditState {
  return (
    isJsonObject(value) &&
    (value.repositoryId === null || typeof value.repositoryId === 'string') &&
    (value.nameWithOwner === null || typeof value.nameWithOwner === 'string') &&
    (value.connectionMode === RepositoryConnectionMode.NEW ||
      value.connectionMode === RepositoryConnectionMode.OWN) &&
    (value.repositoryUrl === null || typeof value.repositoryUrl === 'string')
  );
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
export const PROGRAM_LIFECYCLE_AUDIT_ACTIONS = {
  PROGRAM_ARCHIVED: 'PROGRAM_ARCHIVED',
  PROGRAM_RESTORED: 'PROGRAM_RESTORED',
} as const;
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
export type ProgramLifecycleAuditMetadataV1 =
  ProgramLifecycleAuditMetadataBaseV1;
export type ProgramLifecycleAuditMetadataV2 =
  ProgramLifecycleAuditMetadataBaseV2;
export type ProgramLifecycleAuditMetadata =
  ProgramLifecycleAuditMetadataV1 | ProgramLifecycleAuditMetadataV2;
export type ProgramLifecycleAuditMetadataInput = Omit<
  ProgramLifecycleAuditMetadataV2,
  'schemaVersion'
>;
export type ProgramLifecycleAuditMetadataView = ProgramLifecycleAuditMetadata;

export function createProgramLifecycleAuditMetadata(
  input: ProgramLifecycleAuditMetadataInput,
): ProgramLifecycleAuditMetadataV2 {
  return { schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION, ...input };
}

export function parseProgramLifecycleAuditMetadata(
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
export const PROGRAM_DELETION_AUDIT_ACTIONS = {
  PROGRAM_DELETED: 'PROGRAM_DELETED',
} as const;
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

export function createProgramDeletionAuditMetadata(
  input: Omit<ProgramDeletionAuditMetadata, 'schemaVersion'>,
): ProgramDeletionAuditMetadata {
  return { schemaVersion: PROGRAM_DELETION_AUDIT_SCHEMA_VERSION, ...input };
}

export function parseProgramDeletionAuditMetadata(
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
