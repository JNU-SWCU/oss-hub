import type {
  AuditLogPage,
  AuditLogRecord,
  TeamMembershipChangeSummary,
  TeamMembershipOperation,
  UserPhoneAuditTransition,
} from './types';

const INVALID_RESPONSE_MESSAGE = '감사 로그 응답 형식이 올바르지 않습니다';

export class AuditLogResponseError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE);
    this.name = 'AuditLogResponseError';
  }
}

function invalidResponse(): never {
  throw new AuditLogResponseError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyString(value: unknown): string {
  if (isNonEmptyString(value)) return value;
  return invalidResponse();
}

function nullableHandle(value: unknown): string | null {
  if (value === null) return null;
  return nonEmptyString(value);
}

function userPhoneAuditTransition(value: unknown): UserPhoneAuditTransition {
  if (value === 'SET' || value === 'REPLACED') return value;
  return invalidResponse();
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return invalidResponse();
}

function positiveInteger(value: unknown): number {
  const parsed = nonNegativeInteger(value);
  if (parsed > 0) return parsed;
  return invalidResponse();
}

function isoTimestamp(value: unknown): string {
  const parsed = nonEmptyString(value);
  const date = new Date(parsed);
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString() === parsed
  ) {
    return parsed;
  }
  return invalidResponse();
}

function phoneTransition(
  action: string,
  metadata: Record<string, unknown>,
): UserPhoneAuditTransition | undefined {
  if (action !== 'USER_PHONE_UPDATED') return undefined;
  return userPhoneAuditTransition(metadata.transition);
}

const TEAM_MEMBERSHIP_ACTION = 'TEAM_MEMBERSHIP_CHANGED';
const TEAM_MEMBERSHIP_SCHEMA_VERSION = 1;
const TEAM_MEMBERSHIP_OPERATIONS: readonly TeamMembershipOperation[] = [
  'LEAVE',
  'REMOVE',
];

function isTeamMembershipOperation(
  value: unknown,
): value is TeamMembershipOperation {
  return TEAM_MEMBERSHIP_OPERATIONS.some((operation) => operation === value);
}

function teamMembershipSummary(
  action: string,
  metadata: unknown,
): TeamMembershipChangeSummary | undefined {
  if (action !== TEAM_MEMBERSHIP_ACTION || !isRecord(metadata)) {
    return undefined;
  }
  const { operation, previousLeaderId, nextLeaderId } = metadata;
  if (
    metadata.schemaVersion !== TEAM_MEMBERSHIP_SCHEMA_VERSION ||
    !isNonEmptyString(metadata.programName) ||
    !isNonEmptyString(metadata.teamName) ||
    !isTeamMembershipOperation(operation) ||
    !isNonEmptyString(metadata.removedUserId) ||
    !isNonEmptyString(previousLeaderId) ||
    !(nextLeaderId === null || isNonEmptyString(nextLeaderId))
  ) {
    return undefined;
  }

  return {
    operation,
    leaderChanged: nextLeaderId !== null && nextLeaderId !== previousLeaderId,
    teamDeleted: nextLeaderId === null,
  };
}

const TEAM_RENAMED_ACTION = 'TEAM_RENAMED';
const TEAM_RENAMED_SCHEMA_VERSION = 1;

function teamPreviousName(
  action: string,
  metadata: unknown,
): string | undefined {
  if (action !== TEAM_RENAMED_ACTION || !isRecord(metadata)) return undefined;
  return metadata.schemaVersion === TEAM_RENAMED_SCHEMA_VERSION &&
    isNonEmptyString(metadata.previousName)
    ? metadata.previousName
    : undefined;
}

const RECORD_KEYS = [
  'id',
  'actor',
  'actorHandle',
  'action',
  'targetType',
  'targetId',
  'target',
  'targetHandle',
  'occurredAt',
  'legacy',
  'metadata',
] as const;

function auditLogRecord(value: unknown): AuditLogRecord {
  if (!isRecord(value) || !hasExactKeys(value, RECORD_KEYS)) {
    return invalidResponse();
  }
  if (typeof value.legacy !== 'boolean') {
    return invalidResponse();
  }
  const wireMetadata = value.metadata;
  if (value.legacy ? wireMetadata !== null : !isRecord(wireMetadata)) {
    return invalidResponse();
  }

  const action = nonEmptyString(value.action);
  const teamMembership = teamMembershipSummary(action, wireMetadata);
  const previousName = teamPreviousName(action, wireMetadata);
  const parsedPhoneTransition = isRecord(wireMetadata)
    ? phoneTransition(action, wireMetadata)
    : undefined;

  return {
    id: nonEmptyString(value.id),
    actor: nonEmptyString(value.actor),
    actorHandle: nullableHandle(value.actorHandle),
    action,
    targetType: nonEmptyString(value.targetType),
    targetId: nonEmptyString(value.targetId),
    target: nonEmptyString(value.target),
    targetHandle: nullableHandle(value.targetHandle),

    ...(teamMembership === undefined ? {} : { teamMembership }),
    ...(previousName === undefined ? {} : { teamPreviousName: previousName }),
    occurredAt: isoTimestamp(value.occurredAt),
    ...(parsedPhoneTransition
      ? { phoneTransition: parsedPhoneTransition }
      : {}),
  };
}

const PAGE_KEYS = ['items', 'total', 'page', 'limit'] as const;

export function parseAuditLogPage(value: unknown): AuditLogPage {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PAGE_KEYS) ||
    !Array.isArray(value.items)
  ) {
    return invalidResponse();
  }

  return {
    items: value.items.map(auditLogRecord),
    total: nonNegativeInteger(value.total),
    page: positiveInteger(value.page),
    limit: positiveInteger(value.limit),
  };
}
