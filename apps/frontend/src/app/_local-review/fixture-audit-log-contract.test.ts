import { describe, expect, it } from 'vitest';
import {
  AuditLogResponseError,
  parseAuditLogPage,
} from '@/features/audit-log/parser';
import { resolveLocalReviewResponse } from './fixture-response';

// fixture는 HTTP 200만 내면 통과처럼 보이지만, 키가 하나만 어긋나도 화면은
// "감사 로그를 불러오지 못했습니다"·총 0건·`1 / 1 페이지`로 죽는다. 그래서 화면이
// 실제로 쓰는 파서를 그대로 불러 fixture 출력을 통과시킨다 — 규칙을 여기 복제해
// 두면 파서가 엄격해질 때 이 테스트만 느슨하게 남아 회귀를 놓친다.
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

  it('파서는 화면 DTO 7키 응답을 실제로 거부한다', () => {
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
