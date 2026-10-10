import { isJsonObject } from './audit-metadata-validation';

export const PROGRAM_CREATED_AUDIT_SCHEMA_VERSION = 1 as const;
export const PROGRAM_CREATED_AUDIT_ACTIONS = {
  PROGRAM_CREATED: 'PROGRAM_CREATED',
} as const;
export type ProgramCreatedAuditMetadata = {
  readonly schemaVersion: typeof PROGRAM_CREATED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
};
export type ProgramCreatedAuditMetadataView = ProgramCreatedAuditMetadata;
export function createProgramCreatedAuditMetadata(
  input: Omit<ProgramCreatedAuditMetadata, 'schemaVersion'>,
): ProgramCreatedAuditMetadata {
  return { schemaVersion: PROGRAM_CREATED_AUDIT_SCHEMA_VERSION, ...input };
}

export const TEAM_CREATED_AUDIT_SCHEMA_VERSION = 1 as const;
export const TEAM_CREATED_AUDIT_ACTIONS = {
  TEAM_CREATED: 'TEAM_CREATED',
} as const;
export type TeamCreatedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_CREATED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
};
export type TeamCreatedAuditMetadataView = TeamCreatedAuditMetadata;
export function createTeamCreatedAuditMetadata(
  input: Omit<TeamCreatedAuditMetadata, 'schemaVersion'>,
): TeamCreatedAuditMetadata {
  return { schemaVersion: TEAM_CREATED_AUDIT_SCHEMA_VERSION, ...input };
}

export const TEAM_JOINED_AUDIT_SCHEMA_VERSION = 1 as const;
export const TEAM_JOINED_AUDIT_ACTIONS = {
  TEAM_JOINED: 'TEAM_JOINED',
} as const;
export type TeamJoinedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_JOINED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
};
export type TeamJoinedAuditMetadataView = TeamJoinedAuditMetadata;
export function createTeamJoinedAuditMetadata(
  input: Omit<TeamJoinedAuditMetadata, 'schemaVersion'>,
): TeamJoinedAuditMetadata {
  return { schemaVersion: TEAM_JOINED_AUDIT_SCHEMA_VERSION, ...input };
}

export const APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION = 1 as const;
export const APPLICATION_SUBMITTED_AUDIT_ACTIONS = {
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
} as const;
export type ApplicationSubmittedAuditMetadata = {
  readonly schemaVersion: typeof APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
};
export type ApplicationSubmittedAuditMetadataView =
  ApplicationSubmittedAuditMetadata;
export function createApplicationSubmittedAuditMetadata(
  input: Omit<ApplicationSubmittedAuditMetadata, 'schemaVersion'>,
): ApplicationSubmittedAuditMetadata {
  return {
    schemaVersion: APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}

export const TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION = 1 as const;
export const TEAM_MEMBERSHIP_AUDIT_ACTIONS = {
  TEAM_MEMBERSHIP_CHANGED: 'TEAM_MEMBERSHIP_CHANGED',
} as const;
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
export function createTeamMembershipAuditMetadata(
  input: Omit<TeamMembershipAuditMetadata, 'schemaVersion'>,
): TeamMembershipAuditMetadata {
  return { schemaVersion: TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION, ...input };
}

export const TEAM_RENAMED_AUDIT_SCHEMA_VERSION = 1 as const;
export const TEAM_RENAMED_AUDIT_ACTIONS = {
  TEAM_RENAMED: 'TEAM_RENAMED',
} as const;

export type TeamRenamedAuditMetadata = {
  readonly schemaVersion: typeof TEAM_RENAMED_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly teamName: string;
  readonly previousName: string;
};
export type TeamRenamedAuditMetadataView = TeamRenamedAuditMetadata;
export function createTeamRenamedAuditMetadata(
  input: Omit<TeamRenamedAuditMetadata, 'schemaVersion'>,
): TeamRenamedAuditMetadata {
  return { schemaVersion: TEAM_RENAMED_AUDIT_SCHEMA_VERSION, ...input };
}

export const TEAM_DELETED_AUDIT_SCHEMA_VERSION = 1 as const;
export const TEAM_DELETED_AUDIT_ACTIONS = {
  TEAM_DELETED: 'TEAM_DELETED',
} as const;

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
export function createTeamDeletedAuditMetadata(
  input: Omit<TeamDeletedAuditMetadata, 'schemaVersion'>,
): TeamDeletedAuditMetadata {
  return { schemaVersion: TEAM_DELETED_AUDIT_SCHEMA_VERSION, ...input };
}

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

export function parseTeamDeletedAuditMetadata(
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

export function parseTeamRenamedAuditMetadata(
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

export function parseProgramCreatedAuditMetadata(
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
