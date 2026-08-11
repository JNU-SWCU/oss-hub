import { describe, expect, it } from 'vitest';
import {
  parseAdminAccessDetail,
  parseAdminAccessHistory,
  parseAdminAccessListPage,
} from '@/features/roles/admin-access-api';
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

/**
 * 관리자 접근(`/admin/access`) 픽스처 — QA7 회귀.
 *
 * 이 경로들이 비어 있던 동안 로컬 검토에서는 상세를 직접 열면 항상 "관리자
 * 접근 상세를 불러오지 못했습니다"가 떴다. 기본 404(`LFX_404`)가 상세 화면의
 * 404 판별(`ROL_010`)에 걸리지 않아 일반 실패로 분류된 탓이다.
 *
 * 응답은 화면이 실제로 쓰는 파서에 그대로 통과시켜 검증한다 — 파서가 엄격해서
 * 필드 하나만 어긋나도 화면에서는 같은 오류로 보이므로, 모양만 눈으로 맞춘
 * 단언은 이 결함을 다시 잡아내지 못한다.
 */
describe('admin access local review handlers (QA7)', () => {
  const TARGET_ID = 'synthetic-admin-target';

  it('목록을 화면의 파서가 그대로 받아들인다', () => {
    const page = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access')),
    );

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.total).toBe(page.items.length);
    expect(page.facets.roles.admin).toBeGreaterThan(0);
  });

  it('QA가 직접 연 상세 주소의 사용자가 목록에 실제로 있다', () => {
    const page = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access')),
    );

    expect(page.items.some((item) => item.id === TARGET_ID)).toBe(true);
  });

  it('상세를 직접 열면 200과 함께 프로필이 온다', () => {
    const detail = parseAdminAccessDetail(
      bodyOf(resolve('GET', `users/${TARGET_ID}/access`)),
    );

    expect(detail.id).toBe(TARGET_ID);
    expect(detail.profile.isComplete).toBe(true);
  });

  it('상세 이력도 같은 주소에서 함께 열린다', () => {
    const history = parseAdminAccessHistory(
      bodyOf(
        resolve(
          'GET',
          `users/${TARGET_ID}/access/history`,
          'roleRequestPage=1&roleRequestLimit=20&loginPage=1&loginLimit=20',
        ),
      ),
    );

    expect(history.roleRequests.items.length).toBeGreaterThan(0);
    expect(history.loginHistory.items.length).toBeGreaterThan(0);
  });

  // 없는 사용자는 "불러오지 못했습니다"가 아니라 "찾을 수 없습니다"여야 한다.
  // 그 갈림길이 problem code이므로 코드 자체를 단언한다.
  it('없는 사용자는 ROL_010으로 응답해 상세가 not-found 화면을 그린다', () => {
    const plan = resolve('GET', 'users/no-such-user/access');

    expect(plan).not.toBeNull();
    expect(plan?.kind).toBe('json');
    if (plan?.kind !== 'json') return;
    expect(plan.status).toBe(404);
    expect((plan.body as { readonly code: string }).code).toBe('ROL_010');
  });

  it('역할 필터는 목록을 실제로 좁힌다', () => {
    const all = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access')),
    );
    const admins = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access', 'role=ADMIN')),
    );

    expect(admins.items.length).toBeLessThan(all.items.length);
    expect(admins.items.every((item) => item.role === 'ADMIN')).toBe(true);
  });

  // 패싯은 축마다 **자기 필터만 빼고** 센다 — backend `listAdminAccessFacets` 가
  // `adminAccessWhere(query, 'role')` 처럼 자기 축을 제외한 조건으로 세는 것과 같다.
  // 그래야 「지금 조건에서 이 값을 고르면 몇 건이 되는지」가 뱃지에 나온다.
  it('역할 패싯은 자기 필터를 빼고 세어 다른 역할 칸이 0이 되지 않는다', () => {
    const all = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access')),
    );
    const filtered = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access', 'role=ADMIN')),
    );

    // 고르지 않은 칸이 전부 0이 되면 다른 역할로 옮겨 갈 방법이 화면에서 사라진다.
    expect(filtered.facets.roles).toEqual(all.facets.roles);
  });

  it('다른 축 필터는 패싯 숫자에 실제로 반영된다', () => {
    const all = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access')),
    );
    const deactivated = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access', 'accountStatus=DEACTIVATED')),
    );

    // 계정 상태로 걸렀으므로 승인대기 축은 **그 조건 안에서** 다시 세야 한다.
    // 전체 집합으로 세면 「비활성만 보기」인데 승인 대기 뱃지가 그대로 남아,
    // 로컬 검토의 숫자가 운영과 달라진다.
    expect(deactivated.facets.pendingRequests.pending).toBeLessThan(
      all.facets.pendingRequests.pending,
    );
    // 자기 축(계정 상태)은 전체 기준을 유지한다.
    expect(deactivated.facets.accountStatuses).toEqual(
      all.facets.accountStatuses,
    );
  });

  it('가입순 정렬이 이름순과 다른 순서를 만든다', () => {
    // backend 는 `User.createdAt` 으로 정렬하는데 목록 DTO 는 그 값을 안 내려준다.
    // 픽스처가 내부 생성 시각을 갖고 있지 않으면 이름순으로 조용히 떨어져,
    // 정렬을 바꿔도 순서가 그대로라 검토자가 정렬 결함을 볼 수 없다.
    const byName = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access', 'sort=name&direction=asc')),
    );
    const byCreatedAt = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access', 'sort=createdAt&direction=asc')),
    );

    expect(byCreatedAt.items.map((item) => item.id)).not.toEqual(
      byName.items.map((item) => item.id),
    );

    // 방향을 뒤집으면 정확히 역순이어야 한다.
    const descending = parseAdminAccessListPage(
      bodyOf(resolve('GET', 'users/access', 'sort=createdAt&direction=desc')),
    );
    expect(descending.items.map((item) => item.id)).toEqual(
      [...byCreatedAt.items].reverse().map((item) => item.id),
    );
  });

  it.each([
    'users/access',
    'users/access/facets',
    `users/${TARGET_ID}/access`,
    `users/${TARGET_ID}/access/history`,
  ])('관리자가 아닌 페르소나에는 %s 를 응답하지 않는다', (path) => {
    expect(resolve('GET', path, '', 'staff')).toBeNull();
    expect(resolve('GET', path, '', 'student')).toBeNull();
    expect(resolve('GET', path, '', 'anonymous')).toBeNull();
  });
});
