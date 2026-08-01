import { describe, expect, it } from 'vitest';
import { resolveLocalReviewResponse } from './fixture-response';

// 이 파일이 검증하는 계약의 SSOT는 감사 로그 응답 파서
// (apps/frontend/src/features/audit-log/parser.ts의 parseAuditLogPage)다. 그 모듈은
// 이 브랜치에 아직 없어 import할 수 없어서, 파서가 실제로 거는 검사(9키 exact match,
// legacy/metadata 판별, ISO 타임스탬프, page envelope의 4키)를 여기 그대로 복제해 둔다.
//
// 복제하는 이유: fixture는 HTTP 200만 내면 통과처럼 보이지만, 키가 하나만 어긋나도 화면은
// "감사 로그를 불러오지 못했습니다"·총 0건·`1 / 1 페이지`로 죽는다. 브라우저를 띄우지 않고도
// 이 회귀를 잡으려면 fixture 출력이 파서를 실제로 통과하는지 확인하는 계약 테스트가 필요하다.
// 파서 모듈이 이 브랜치에 들어오는 시점에 아래 복제본은 지우고 실제 parseAuditLogPage를
// import해야 한다 — 복제본이 파서보다 느슨해지면 이 테스트는 의미를 잃는다.
const RECORD_KEYS = [
  'id',
  'actor',
  'action',
  'targetType',
  'targetId',
  'target',
  'occurredAt',
  'legacy',
  'metadata',
] as const;

const PAGE_KEYS = ['items', 'total', 'page', 'limit'] as const;

class AuditLogResponseError extends Error {
  constructor() {
    super('감사 로그 응답 형식이 올바르지 않습니다');
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

function auditLogRecord(value: unknown) {
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
    action: nonEmptyString(value.action),
    targetType: nonEmptyString(value.targetType),
    targetId: nonEmptyString(value.targetId),
    target: nonEmptyString(value.target),
    occurredAt: isoTimestamp(value.occurredAt),
  };
}

function parseAuditLogPage(value: unknown) {
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

function auditLogFixtureBody(query: string): unknown {
  const response = resolveLocalReviewResponse({
    fixture: 'admin',
    method: 'GET',
    path: 'audit-logs',
    searchParams: new URLSearchParams(query),
  });
  if (response.kind !== 'json' || response.status !== 200) {
    throw new Error('감사 로그 fixture가 200 json 응답이 아닙니다.');
  }
  return response.body;
}

describe('audit log fixture wire contract', () => {
  it('기본 limit의 1페이지가 파서를 그대로 통과한다', () => {
    // Given / When — 화면이 처음 여는 요청과 같은 쿼리다.
    const page = parseAuditLogPage(auditLogFixtureBody('page=1&limit=20'));

    // Then
    expect(page.page).toBe(1);
    expect(page.limit).toBe(20);
    expect(page.total).toBe(23);
    expect(page.items).toHaveLength(20);
  });

  it('페이지 이동·필터·빈 결과 응답도 모두 파서를 통과한다', () => {
    // Given / When
    const second = parseAuditLogPage(auditLogFixtureBody('page=2&limit=20'));
    const filtered = parseAuditLogPage(
      auditLogFixtureBody(
        'action=STAFF_ROLE_REQUEST_APPROVED&actor=synthetic-admin&page=1&limit=20',
      ),
    );
    const empty = parseAuditLogPage(
      auditLogFixtureBody('actor=nobody&page=1&limit=20'),
    );

    // Then
    expect(second.items).toHaveLength(3);
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(empty.items).toHaveLength(0);
    expect(empty.total).toBe(0);
  });

  it('모든 fixture 레코드가 wire record 9키를 정확히 갖는다', () => {
    // Given
    const body = auditLogFixtureBody('page=1&limit=100') as {
      readonly items: readonly Record<string, unknown>[];
    };

    // When / Then
    expect(body.items).toHaveLength(23);
    for (const record of body.items) {
      expect(Object.keys(record).sort()).toEqual([...RECORD_KEYS].sort());
      expect(typeof record.legacy).toBe('boolean');
      if (record.legacy) {
        expect(record.metadata).toBeNull();
      } else {
        expect(record.metadata).toEqual(expect.any(Object));
      }
    }
    // legacy·비legacy 두 갈래가 모두 들어 있어야 파서의 두 분기를 실제로 지나간다.
    const legacyCount = body.items.filter((record) => record.legacy).length;
    expect(legacyCount).toBeGreaterThan(0);
    expect(legacyCount).toBeLessThan(body.items.length);
  });

  it('복제한 파서는 화면 DTO 7키 응답을 실제로 거부한다', () => {
    // Given — 이 테스트가 무엇이든 통과시키는 빈 검사가 아님을 보장한다.
    const body = auditLogFixtureBody('page=1&limit=1') as {
      readonly items: readonly Record<string, unknown>[];
      readonly total: number;
      readonly page: number;
      readonly limit: number;
    };
    const screenDtoOnly = {
      ...body,
      items: body.items.map((record) => {
        const stripped = { ...record };
        delete stripped.legacy;
        delete stripped.metadata;
        return stripped;
      }),
    };

    // When / Then
    expect(() => parseAuditLogPage(screenDtoOnly)).toThrow(
      AuditLogResponseError,
    );
    expect(() => parseAuditLogPage(body.items)).toThrow(AuditLogResponseError);
  });
});
