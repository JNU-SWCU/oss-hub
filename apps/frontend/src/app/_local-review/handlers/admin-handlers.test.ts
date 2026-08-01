import { describe, expect, it } from 'vitest';
import type { AuditLogRecord } from '@/features/audit-log/types';
import type { SystemStatusResponse } from '@/features/system-status/types';
import type { LocalReviewFixtureId } from '../fixture-contract';
import {
  isAuthenticatedFixture,
  roleForFixture,
  type LocalReviewContext,
  type LocalReviewResponsePlan,
} from '../handler-kit';
import { ADMIN_HANDLERS } from './admin-handlers';

function contextFor(
  method: string,
  path: string,
  search = '',
  fixture: LocalReviewFixtureId = 'admin',
): LocalReviewContext {
  return {
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(search),
    role: roleForFixture(fixture),
    isAuthenticated: isAuthenticatedFixture(fixture),
  };
}

function resolve(
  method: string,
  path: string,
  search = '',
  fixture: LocalReviewFixtureId = 'admin',
): LocalReviewResponsePlan | null {
  const context = contextFor(method, path, search, fixture);
  for (const handler of ADMIN_HANDLERS) {
    const plan = handler(context);
    if (plan !== null) return plan;
  }
  return null;
}

/** 승인·반려처럼 요청 본문에만 있는 입력을 그대로 실어 보낸다. */
function resolveWithBody(
  method: string,
  path: string,
  body: unknown,
  fixture: LocalReviewFixtureId = 'admin',
): LocalReviewResponsePlan | null {
  const context: LocalReviewContext = {
    ...contextFor(method, path, '', fixture),
    body,
  };
  for (const handler of ADMIN_HANDLERS) {
    const plan = handler(context);
    if (plan !== null) return plan;
  }
  return null;
}

function bodyOf<T>(plan: LocalReviewResponsePlan | null, status = 200): T {
  if (plan === null) throw new Error('expected an admin fixture plan');
  if (plan.kind !== 'json') throw new Error('expected a json fixture plan');
  expect(plan.status).toBe(status);
  return plan.body as T;
}

describe('admin local review handlers', () => {
  // 사용자 목록·역할 변경·교직원 요청 판정 테스트가 여기 있었지만, 그 화면들이
  // 관리자 접근(`/admin/access`) 한 곳으로 합쳐지면서 경로와 타입이 함께
  // 사라졌다. 남은 두 경로만 검증한다.
  it('감사 로그는 배열로 오고 액션·기간 필터를 반영한다', () => {
    // Given / When
    const all = bodyOf<readonly AuditLogRecord[]>(resolve('GET', 'audit-logs'));
    const approvedOnly = bodyOf<readonly AuditLogRecord[]>(
      resolve('GET', 'audit-logs', 'action=STAFF_ROLE_REQUEST_APPROVED'),
    );
    const period = bodyOf<readonly AuditLogRecord[]>(
      resolve('GET', 'audit-logs', 'from=2026-07-01&to=2026-07-15'),
    );

    // Then
    expect(all.length).toBeGreaterThan(approvedOnly.length);
    expect(
      approvedOnly.every(
        (record) => record.action === 'STAFF_ROLE_REQUEST_APPROVED',
      ),
    ).toBe(true);
    expect(
      period.every(
        (record) =>
          record.occurredAt >= '2026-07-01' &&
          record.occurredAt <= '2026-07-16',
      ),
    ).toBe(true);
  });

  it('감사 로그의 행위자 검색은 대소문자를 가리지 않는다', () => {
    // Given / When
    const matched = bodyOf<readonly AuditLogRecord[]>(
      resolve('GET', 'audit-logs', 'actor=SYNTHETIC-ADMIN'),
    );

    // Then
    expect(matched.length).toBeGreaterThan(0);
  });

  it('시스템 상태는 collection 아래에 담겨 온다', () => {
    // Given / When
    const response = bodyOf<SystemStatusResponse>(
      resolve('GET', 'system-status'),
    );

    // Then — fetchSystemStatus가 response.collection을 그대로 꺼내 쓴다.
    expect(response.collection.health).toBe('DELAYED');
    expect(response.collection.safeReason).toBe('STALE_DATA');
  });

  it.each(['audit-logs', 'system-status'])(
    '관리자가 아닌 페르소나에는 %s 를 응답하지 않는다',
    (path) => {
      // Given / When
      const staff = resolve('GET', path, '', 'staff');
      const student = resolve('GET', path, '', 'student');
      const anonymous = resolve('GET', path, '', 'anonymous');

      // Then — null이면 기본 404로 떨어진다.
      expect(staff).toBeNull();
      expect(student).toBeNull();
      expect(anonymous).toBeNull();
    },
  );
});
