import { isRecord } from '@/lib/is-record';
import {
  AUDIT_LOG_CATEGORIES,
  type AuditLogCategory,
  type AuditLogCategoryCounts,
  type AuditLogChange,
  type AuditLogPage,
  type AuditLogPerson,
  type AuditLogRecord,
  type AuditLogTarget,
  type TeamMembershipChange,
  type TeamMembershipOperation,
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

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) return invalidResponse();
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    return invalidResponse();
  }
  return value;
}

function nonEmptyString(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return invalidResponse();
}

function nullableString(value: unknown): string | null {
  return value === null ? null : nonEmptyString(value);
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

function category(value: unknown): AuditLogCategory {
  return (
    AUDIT_LOG_CATEGORIES.find((candidate) => candidate === value) ??
    invalidResponse()
  );
}

function person(value: unknown): AuditLogPerson | null {
  if (value === null) return null;
  const record = exactRecord(value, ['id', 'name', 'login', 'role']);
  return {
    id: nullableString(record.id),
    name: nullableString(record.name),
    login: nullableString(record.login),
    role: nullableString(record.role),
  };
}

const TARGET_KEYS = [
  'type',
  'id',
  'name',
  'login',
  'role',
  'programName',
  'teamName',
] as const;

function target(value: unknown): AuditLogTarget {
  const record = exactRecord(value, TARGET_KEYS);
  return {
    type: nonEmptyString(record.type),
    id: nonEmptyString(record.id),
    name: nullableString(record.name),
    login: nullableString(record.login),
    role: nullableString(record.role),
    programName: nullableString(record.programName),
    teamName: nullableString(record.teamName),
  };
}

function change(value: unknown): AuditLogChange | null {
  if (value === null) return null;
  const record = exactRecord(value, ['before', 'after']);
  return {
    before: nullableString(record.before),
    after: nullableString(record.after),
  };
}

const TEAM_MEMBERSHIP_OPERATIONS: readonly TeamMembershipOperation[] = [
  'LEAVE',
  'REMOVE',
  'TRANSFER_LEADER',
];

function teamMembership(value: unknown): TeamMembershipChange | null {
  if (value === null) return null;
  const record = exactRecord(value, [
    'operation',
    'leaderChanged',
    'teamDeleted',
  ]);
  const operation =
    TEAM_MEMBERSHIP_OPERATIONS.find((item) => item === record.operation) ??
    invalidResponse();
  if (
    typeof record.leaderChanged !== 'boolean' ||
    typeof record.teamDeleted !== 'boolean'
  ) {
    return invalidResponse();
  }
  return {
    operation,
    leaderChanged: record.leaderChanged,
    teamDeleted: record.teamDeleted,
  };
}

function phoneTransition(
  action: string,
  metadata: unknown,
): AuditLogRecord['phoneTransition'] {
  if (action !== 'USER_PHONE_UPDATED' || !isRecord(metadata)) return null;
  return metadata.transition === 'SET' || metadata.transition === 'REPLACED'
    ? metadata.transition
    : null;
}

const RECORD_KEYS = [
  'id',
  'occurredAt',
  'action',
  'category',
  'actor',
  'target',
  'change',
  'requestId',
  'teamMembership',
  'legacy',
  'metadata',
] as const;

function auditLogRecord(value: unknown): AuditLogRecord {
  const record = exactRecord(value, RECORD_KEYS);
  if (typeof record.legacy !== 'boolean') return invalidResponse();
  if (record.legacy ? record.metadata !== null : !isRecord(record.metadata)) {
    return invalidResponse();
  }
  const action = nonEmptyString(record.action);
  return {
    id: nonEmptyString(record.id),
    occurredAt: isoTimestamp(record.occurredAt),
    action,
    category: category(record.category),
    actor: person(record.actor),
    target: target(record.target),
    change: change(record.change),
    requestId: nullableString(record.requestId),
    teamMembership: teamMembership(record.teamMembership),
    phoneTransition: phoneTransition(action, record.metadata),
  };
}

function counts(value: unknown): AuditLogCategoryCounts {
  const record = exactRecord(value, AUDIT_LOG_CATEGORIES);
  return {
    ACCOUNT: nonNegativeInteger(record.ACCOUNT),
    OPERATION: nonNegativeInteger(record.OPERATION),
    SUBMISSION: nonNegativeInteger(record.SUBMISSION),
    LOGIN: nonNegativeInteger(record.LOGIN),
    SYSTEM: nonNegativeInteger(record.SYSTEM),
  };
}

export function parseAuditLogPage(value: unknown): AuditLogPage {
  const page = exactRecord(value, [
    'items',
    'total',
    'page',
    'limit',
    'counts',
  ]);
  if (!Array.isArray(page.items)) return invalidResponse();
  return {
    items: page.items.map(auditLogRecord),
    total: nonNegativeInteger(page.total),
    page: positiveInteger(page.page),
    limit: positiveInteger(page.limit),
    counts: counts(page.counts),
  };
}
