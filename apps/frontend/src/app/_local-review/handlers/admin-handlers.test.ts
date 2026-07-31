import { describe, expect, it } from 'vitest';
import type { AuditLogRecord } from '@/features/audit-log/types';
import type { AdminUser, StaffRoleRequest } from '@/features/roles/types';
import { requiresRoleChangeConfirmation } from '@/features/roles/role-change-policy';
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
  it('사용자 목록은 배열로 오고 본인 계정이 하나 있다', () => {
    // Given / When
    const users = bodyOf<readonly AdminUser[]>(resolve('GET', 'users'));

    // Then — 화면은 배열을 그대로 순회한다(fetchAdminUsers 계약).
    expect(Array.isArray(users)).toBe(true);
    expect(users.filter((user) => user.isSelf)).toHaveLength(1);
    expect(users.find((user) => user.isSelf)?.githubLogin).toBe(
      'synthetic-admin',
    );
  });

  it('사용자 목록은 검색어·역할 필터를 반영한다', () => {
    // Given / When
    const searched = bodyOf<readonly AdminUser[]>(
      resolve('GET', 'users', 'query=approved'),
    );
    const staffOnly = bodyOf<readonly AdminUser[]>(
      resolve('GET', 'users', 'role=STAFF'),
    );

    // Then
    expect(searched.map((user) => user.githubLogin)).toEqual([
      'synthetic-approved-staff',
    ]);
    expect(staffOnly.every((user) => user.role === 'STAFF')).toBe(true);
  });

  it('역할 강등 확인 다이얼로그를 밟아 볼 수 있는 사용자가 있다', () => {
    // Given
    const users = bodyOf<readonly AdminUser[]>(resolve('GET', 'users'));

    // When
    const needsConfirmation = users.filter((user) =>
      requiresRoleChangeConfirmation(user, 'STUDENT'),
    );

    // Then
    expect(needsConfirmation.length).toBeGreaterThan(0);
  });

  it('역할 변경은 목록에 있는 사용자를 그대로 돌려준다', () => {
    // Given
    const users = bodyOf<readonly AdminUser[]>(resolve('GET', 'users'));
    const target = users[0] as AdminUser;

    // When
    const updated = bodyOf<AdminUser>(
      resolve('PATCH', `users/${target.id}/role`),
    );

    // Then
    expect(updated.id).toBe(target.id);
    expect(updated.isSelf).toBe(target.isSelf);
  });

  it('없는 사용자의 역할 변경은 404를 준다', () => {
    // Given / When
    const plan = resolve('PATCH', 'users/synthetic-missing/role');

    // Then
    expect(plan).toMatchObject({ kind: 'json', status: 404 });
  });

  it('교직원 요청 판정은 목록과 같은 id로 답한다', () => {
    // Given / When
    const decided = bodyOf<StaffRoleRequest>(
      resolve('PATCH', 'role-requests/fixture:staff-request:pending'),
    );

    // Then — id·핸들은 fixture-response의 요청 목록과 같은 값이다.
    expect(decided.id).toBe('fixture:staff-request:pending');
    expect(decided.githubLogin).toBe('synthetic-staff');
    expect(decided.decidedBy).toBe('synthetic-admin');
  });

  it('교직원 요청 반려는 반려로, 회수는 회수로 돌아온다', () => {
    // Given: 화면은 `{ action }`(REJECT는 사유까지) 를 보낸다.
    const approved = bodyOf<StaffRoleRequest>(
      resolveWithBody('PATCH', 'role-requests/fixture:staff-request:pending', {
        action: 'APPROVE',
      }),
    );

    // When
    const rejected = bodyOf<StaffRoleRequest>(
      resolveWithBody('PATCH', 'role-requests/fixture:staff-request:pending', {
        action: 'REJECT',
        reason: '합성 반려 사유',
      }),
    );
    const revoked = bodyOf<StaffRoleRequest>(
      resolveWithBody('PATCH', 'role-requests/fixture:staff-request:approved', {
        action: 'REVOKE',
      }),
    );

    // Then — 반려를 눌렀는데 승인이 돌아오면 검토자가 제품 버그로 오해한다.
    expect(approved.status).toBe('APPROVED');
    expect(approved.rejectionReason).toBeNull();
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('합성 반려 사유');
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.rejectionReason).toBeNull();
  });

  it('본문이 없거나 JSON 객체가 아니면 승인으로 답한다', () => {
    // Given / When
    const noBody = bodyOf<StaffRoleRequest>(
      resolve('PATCH', 'role-requests/fixture:staff-request:pending'),
    );
    const notAnObject = bodyOf<StaffRoleRequest>(
      resolveWithBody(
        'PATCH',
        'role-requests/fixture:staff-request:pending',
        'REJECT',
      ),
    );

    // Then — 화면이 저장 실패로 멈추는 것보다 확정 응답이 낫다.
    expect(noBody.status).toBe('APPROVED');
    expect(notAnObject.status).toBe('APPROVED');
  });

  it('역할 변경은 고른 역할을 반영한다', () => {
    // Given: 화면은 `{ role }`을 보낸다(updateAdminUserRole 계약).
    const target = 'synthetic-user-11';

    // When
    const promoted = bodyOf<AdminUser>(
      resolveWithBody('PATCH', `users/${target}/role`, { role: 'STAFF' }),
    );
    const unknownRole = bodyOf<AdminUser>(
      resolveWithBody('PATCH', `users/${target}/role`, { role: 'SYNTHETIC' }),
    );

    // Then
    expect(promoted.role).toBe('STAFF');
    expect(promoted.id).toBe(target);
    // 계약 밖의 값은 저장 전 역할을 유지한다.
    expect(unknownRole.role).toBe('STUDENT');
  });

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

  it.each(['users', 'audit-logs', 'system-status'])(
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

  it('관리자가 아닌 페르소나는 관리자 조작도 할 수 없다', () => {
    // Given / When
    const roleChange = resolve(
      'PATCH',
      'users/synthetic-user-11/role',
      '',
      'staff',
    );
    const decision = resolve(
      'PATCH',
      'role-requests/fixture:staff-request:pending',
      '',
      'staff',
    );

    // Then
    expect(roleChange).toBeNull();
    expect(decision).toBeNull();
  });
});
