import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import type { AdminAccessDetail } from './admin-access-api';
import {
  ADMIN_ACCESS_MUTATION_ACTIONS,
  actionForAccountStatus,
  actionForRole,
  adminAccessMutationErrorMessage,
  adminAccessMutationSuccessMessage,
  applyAdminAccessConflictProjection,
  buildAdminAccessPatchRequest,
  classifyAdminAccessMutationBlock,
  rankOfAdminAccessRole,
  roleForAction,
} from './admin-access-mutation-policy';

function detail(overrides: Partial<AdminAccessDetail> = {}): AdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'synthetic-target',
    name: '합성 사용자',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: '2026-07-30T01:00:00.000Z',
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      department: '인공지능학부',
      isComplete: true,
    },
    ...overrides,
  };
}

const pending = {
  id: 'req-1',
  status: 'PENDING' as const,
  createdAt: '2026-07-30T00:00:00.000Z',
};

function apiError(status: number, code: string, detailText: string): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'error',
    status,
    detail: detailText,
    instance: '/users/target/access',
    code,
  });
}

describe('rankOfAdminAccessRole', () => {
  it('STUDENT < STAFF < ADMIN 순으로 등급을 매긴다', () => {
    expect(rankOfAdminAccessRole('STUDENT')).toBeLessThan(
      rankOfAdminAccessRole('STAFF'),
    );
    expect(rankOfAdminAccessRole('STAFF')).toBeLessThan(
      rankOfAdminAccessRole('ADMIN'),
    );
  });

  it('미지정(null)은 STUDENT와 같은 등급이다', () => {
    expect(rankOfAdminAccessRole(null)).toBe(rankOfAdminAccessRole('STUDENT'));
  });
});

describe('actionForRole / roleForAction', () => {
  it('역할과 SET_ROLE_* 액션을 서로 변환한다', () => {
    expect(actionForRole('STUDENT')).toBe('SET_ROLE_STUDENT');
    expect(actionForRole('STAFF')).toBe('SET_ROLE_STAFF');
    expect(actionForRole('ADMIN')).toBe('SET_ROLE_ADMIN');
    expect(roleForAction('SET_ROLE_STUDENT')).toBe('STUDENT');
    expect(roleForAction('SET_ROLE_STAFF')).toBe('STAFF');
    expect(roleForAction('SET_ROLE_ADMIN')).toBe('ADMIN');
  });
});

describe('actionForAccountStatus', () => {
  it('계정 상태와 SET_STATUS_* 액션을 변환한다', () => {
    expect(actionForAccountStatus('ACTIVE')).toBe('SET_STATUS_ACTIVE');
    expect(actionForAccountStatus('DEACTIVATED')).toBe(
      'SET_STATUS_DEACTIVATED',
    );
  });
});

describe('buildAdminAccessPatchRequest', () => {
  it('APPROVE는 STAFF/ACTIVE로 승격하는 CAS 본문과 결정을 함께 담는다', () => {
    const withPending = detail({ pendingRequest: pending, role: null });
    const body = buildAdminAccessPatchRequest(
      ADMIN_ACCESS_MUTATION_ACTIONS.APPROVE,
      withPending,
    );

    expect(body).toEqual({
      expectedRole: null,
      expectedAccountStatus: 'ACTIVE',
      expectedPendingRequest: { id: 'req-1', status: 'PENDING' },
      desiredRole: 'STAFF',
      desiredAccountStatus: 'ACTIVE',
      requestDecision: { decision: 'APPROVE' },
    });
  });

  it('REJECT는 현재 역할/상태를 유지하고 사유를 담은 REJECT 결정을 포함한다', () => {
    const withPending = detail({ pendingRequest: pending, role: null });
    const body = buildAdminAccessPatchRequest(
      ADMIN_ACCESS_MUTATION_ACTIONS.REJECT,
      withPending,
      { reason: '자격 요건 미충족' },
    );

    expect(body.desiredRole).toBeNull();
    expect(body.desiredAccountStatus).toBe('ACTIVE');
    expect(body.requestDecision).toEqual({
      decision: 'REJECT',
      reason: '자격 요건 미충족',
    });
  });

  it.each([
    ['SET_ROLE_STUDENT', 'STUDENT'],
    ['SET_ROLE_STAFF', 'STAFF'],
    ['SET_ROLE_ADMIN', 'ADMIN'],
  ] as const)(
    '%s는 임의의 역할로 직접 점프하는 CAS 본문을 만든다(사다리 제약 없음)',
    (action, targetRole) => {
      const staff = detail({ role: 'STAFF', pendingRequest: null });
      const body = buildAdminAccessPatchRequest(action, staff);

      expect(body.expectedRole).toBe('STAFF');
      expect(body.desiredRole).toBe(targetRole);
      // 역할 변경 액션은 계정 상태를 현재 값 그대로 보낸다 — 백엔드가 역할과
      // 상태의 동시 변경을 거부하기 때문이다
      // (`admin-access-transition-table.ts`의 `classifyTransition`).
      expect(body.desiredAccountStatus).toBe(staff.accountStatus);
      expect(body.requestDecision).toBeUndefined();
    },
  );

  it('SET_STATUS_DEACTIVATED/ACTIVE는 역할을 유지하고 계정 상태만 뒤집는다', () => {
    const active = detail({ accountStatus: 'ACTIVE', pendingRequest: null });
    const deactivateBody = buildAdminAccessPatchRequest(
      ADMIN_ACCESS_MUTATION_ACTIONS.SET_STATUS_DEACTIVATED,
      active,
    );
    expect(deactivateBody.desiredRole).toBe(active.role);
    expect(deactivateBody.desiredAccountStatus).toBe('DEACTIVATED');

    const deactivated = detail({
      accountStatus: 'DEACTIVATED',
      pendingRequest: null,
    });
    const reactivateBody = buildAdminAccessPatchRequest(
      ADMIN_ACCESS_MUTATION_ACTIONS.SET_STATUS_ACTIVE,
      deactivated,
    );
    expect(reactivateBody.desiredRole).toBe(deactivated.role);
    expect(reactivateBody.desiredAccountStatus).toBe('ACTIVE');
  });

  it('CAS expected* 필드는 항상 전달된 detail의 현재 값을 그대로 반영한다', () => {
    const withPending = detail({
      role: 'ADMIN',
      accountStatus: 'DEACTIVATED',
      pendingRequest: pending,
    });
    const body = buildAdminAccessPatchRequest(
      ADMIN_ACCESS_MUTATION_ACTIONS.REJECT,
      withPending,
      { reason: 'x' },
    );

    expect(body.expectedRole).toBe('ADMIN');
    expect(body.expectedAccountStatus).toBe('DEACTIVATED');
    expect(body.expectedPendingRequest).toEqual({
      id: 'req-1',
      status: 'PENDING',
    });
  });
});

describe('applyAdminAccessConflictProjection', () => {
  it('CAS 관련 필드만 authoritative projection으로 교체하고 나머지는 유지한다', () => {
    const stale = detail({
      role: 'STAFF',
      accountStatus: 'ACTIVE',
      pendingRequest: null,
    });
    const merged = applyAdminAccessConflictProjection(stale, {
      id: 'target',
      role: 'ADMIN',
      accountStatus: 'DEACTIVATED',
      pendingRequest: pending,
    });

    expect(merged.role).toBe('ADMIN');
    expect(merged.accountStatus).toBe('DEACTIVATED');
    expect(merged.pendingRequest).toEqual(pending);
    // 프로필/이름 등 conflict projection에 없는 필드는 그대로 보존된다.
    expect(merged.profile).toEqual(stale.profile);
    expect(merged.name).toBe(stale.name);
    expect(merged.githubLogin).toBe(stale.githubLogin);
  });
});

describe('classifyAdminAccessMutationBlock', () => {
  it('ROL_017은 자기 자신 비활성화 차단으로 분류한다', () => {
    const error = apiError(
      409,
      'ROL_017',
      '관리자는 자신의 계정을 비활성화할 수 없습니다.',
    );
    expect(classifyAdminAccessMutationBlock(error)).toBe('SELF_DEACTIVATION');
  });

  it('ROL_018은 최소 활성 관리자 차단으로 분류한다', () => {
    const error = apiError(
      409,
      'ROL_018',
      '활성 관리자 계정을 최소 한 개 유지해야 합니다.',
    );
    expect(classifyAdminAccessMutationBlock(error)).toBe('LAST_ACTIVE_ADMIN');
  });

  it('CAS 충돌(ROL_013) 등 다른 에러는 null로 분류한다', () => {
    const error = apiError(409, 'ROL_013', '다른 관리자가 먼저 변경했습니다.');
    expect(classifyAdminAccessMutationBlock(error)).toBeNull();
  });

  it('ApiError가 아닌 에러는 null로 분류한다', () => {
    expect(
      classifyAdminAccessMutationBlock(new Error('network down')),
    ).toBeNull();
  });
});

describe('adminAccessMutationErrorMessage', () => {
  it('ApiError는 backend problem.detail을 그대로 사용한다', () => {
    const error = apiError(
      409,
      'ROL_017',
      '관리자는 자신의 계정을 비활성화할 수 없습니다.',
    );
    expect(adminAccessMutationErrorMessage(error)).toBe(
      '관리자는 자신의 계정을 비활성화할 수 없습니다.',
    );
  });

  it('ApiError가 아니면 일반 안내 메시지로 대체한다', () => {
    expect(adminAccessMutationErrorMessage(new Error('network down'))).toBe(
      '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  });
});

describe('adminAccessMutationSuccessMessage', () => {
  it('대상 사용자와 작업 라벨을 포함한 완료 메시지를 만든다', () => {
    expect(
      adminAccessMutationSuccessMessage(
        'SET_STATUS_DEACTIVATED',
        'synthetic-target',
      ),
    ).toBe('synthetic-target님에 대한 계정 비활성화 처리를 완료했습니다.');
    expect(
      adminAccessMutationSuccessMessage('SET_ROLE_ADMIN', 'synthetic-target'),
    ).toBe('synthetic-target님에 대한 관리자로 역할 변경 처리를 완료했습니다.');
  });
});
