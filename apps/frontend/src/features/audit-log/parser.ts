import type { AuditLogPage, AuditLogRecord } from './types';

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

function nonEmptyString(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return invalidResponse();
}

function nullableHandle(value: unknown): string | null {
  if (value === null) return null;
  return nonEmptyString(value);
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

// 백엔드 AuditLogRecord(apps/backend/src/audit-log/audit-log.repository.ts)는
// discriminated union이라 매 행에 `legacy`·`metadata`가 함께 실려 온다. exact-key
// 검증은 이 실제 wire shape 그대로 받아들이되, 반환값에는 화면이 쓰는 라벨 필드(`target`)만
// 남기고 `metadata`(이벤트 원문 스냅샷)는 파싱 즉시 버린다 — 화면에 raw metadata가
// 흘러갈 경로 자체를 parser 레벨에서 차단한다.
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
  if (value.legacy ? value.metadata !== null : !isRecord(value.metadata)) {
    return invalidResponse();
  }

  return {
    id: nonEmptyString(value.id),
    actor: nonEmptyString(value.actor),
    actorHandle: nullableHandle(value.actorHandle),
    action: nonEmptyString(value.action),
    targetType: nonEmptyString(value.targetType),
    targetId: nonEmptyString(value.targetId),
    target: nonEmptyString(value.target),
    targetHandle: nullableHandle(value.targetHandle),
    occurredAt: isoTimestamp(value.occurredAt),
  };
}

const PAGE_KEYS = ['items', 'total', 'page', 'limit'] as const;

/**
 * `GET /api/v1/audit-logs` 응답을 `{ items, total, page, limit }` 정확한 키 집합으로
 * 검증한다. 과거 프런트가 응답을 배열로 가정해 표가 렌더링되지 않던 계약 불일치를
 * 다시 만들지 않도록, 배열이나 다른 모양이 오면 조용히 통과시키지 않고 던진다.
 */
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
