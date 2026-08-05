import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import type { AdminAccessDetail } from './admin-access-api';
import {
  ADMIN_ACCESS_MUTATION_ACTIONS,
  adminAccessGrantTargetRole,
  adminAccessMutationErrorMessage,
  adminAccessMutationSuccessMessage,
  applyAdminAccessConflictProjection,
  buildAdminAccessPatchRequest,
  classifyAdminAccessMutationBlock,
  isAdminAccessMutationAvailable,
} from './admin-access-mutation-policy';
import { adminAccessRevocation } from './admin-access-revocation';

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

describe('adminAccessGrantTargetRole / adminAccessRevocation', () => {
  it('부여 대상은 한 단계 위 역할이다', () => {
    expect(adminAccessGrantTargetRole(null)).toBe('STAFF');
    expect(adminAccessGrantTargetRole('STUDENT')).toBe('STAFF');
    expect(adminAccessGrantTargetRole('STAFF')).toBe('ADMIN');
  });

  it('이미 최고 등급(ADMIN)이면 부여 대상이 없다', () => {
    expect(adminAccessGrantTargetRole('ADMIN')).toBeNull();
  });

  it('ADMIN 회수는 STAFF 전환이고 STAFF 회수는 역할 제거다', () => {
    expect(adminAccessRevocation('ADMIN')?.desiredRole).toBe('STAFF');
    expect(adminAccessRevocation('STAFF')?.desiredRole).toBeNull();
  });

  it('이미 최저 등급(STUDENT/미지정)이면 회수 대상이 없다', () => {
    expect(adminAccessRevocation('STUDENT')).toBeNull();
    expect(adminAccessRevocation(null)).toBeNull();
  });
});

describe('isAdminAccessMutationAvailable', () => {
  it('대기 중인 요청이 있으면 승인/반려만 가능하다', () => {
    const withPending = detail({ pendingRequest: pending });
    expect(isAdminAccessMutationAvailable('APPROVE', withPending)).toBe(true);
    expect(isAdminAccessMutationAvailable('REJECT', withPending)).toBe(true);
    expect(isAdminAccessMutationAvailable('GRANT', withPending)).toBe(false);
    expect(isAdminAccessMutationAvailable('REVOKE', withPending)).toBe(false);
    expect(isAdminAccessMutationAvailable('DEACTIVATE', withPending)).toBe(
      false,
    );
    expect(isAdminAccessMutationAvailable('REACTIVATE', withPending)).toBe(
      false,
    );
  });

  it('대기 중인 요청이 없으면 승인/반려는 불가능하다', () => {
    const withoutPending = detail({ pendingRequest: null });
    expect(isAdminAccessMutationAvailable('APPROVE', withoutPending)).toBe(
      false,
    );
    expect(isAdminAccessMutationAvailable('REJECT', withoutPending)).toBe(
      false,
    );
  });

  it('최고 등급(ADMIN)이면 GRANT를 제공하지 않는다', () => {
    const admin = detail({ role: 'ADMIN', pendingRequest: null });
    expect(isAdminAccessMutationAvailable('GRANT', admin)).toBe(false);
    expect(isAdminAccessMutationAvailable('REVOKE', admin)).toBe(true);
  });

  it('최저 등급(STUDENT)이면 REVOKE를 제공하지 않는다', () => {
    const student = detail({ role: 'STUDENT', pendingRequest: null });
    expect(isAdminAccessMutationAvailable('REVOKE', student)).toBe(false);
    expect(isAdminAccessMutationAvailable('GRANT', student)).toBe(true);
  });

  it('DEACTIVATE는 활성 계정에서만, REACTIVATE는 비활성 계정에서만 가능하다', () => {
    const active = detail({ accountStatus: 'ACTIVE', pendingRequest: null });
    const deactivated = detail({
      accountStatus: 'DEACTIVATED',
      pendingRequest: null,
    });
    expect(isAdminAccessMutationAvailable('DEACTIVATE', active)).toBe(true);
    expect(isAdminAccessMutationAvailable('REACTIVATE', active)).toBe(false);
    expect(isAdminAccessMutationAvailable('DEACTIVATE', deactivated)).toBe(
      false,
    );
    expect(isAdminAccessMutationAvailable('REACTIVATE', deactivated)).toBe(
      true,
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

  it('GRANT는 한 단계 위 역할을 desiredRole로 CAS 본문을 구성한다', () => {
    const staff = detail({ role: 'STAFF', pendingRequest: null });
    const body = buildAdminAccessPatchRequest(
      ADMIN_ACCESS_MUTATION_ACTIONS.GRANT,
      staff,
    );

    expect(body.expectedRole).toBe('STAFF');
    expect(body.desiredRole).toBe('ADMIN');
    expect(body.desiredAccountStatus).toBe('ACTIVE');
    expect(body.requestDecision).toBeUndefined();
  });

  it('REVOKE는 한 단계 아래 역할을 desiredRole로 CAS 본문을 구성한다', () => {
    const admin = detail({ role: 'ADMIN', pendingRequest: null });
    const body = buildAdminAccessPatchRequest(
      ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE,
      admin,
    );

    expect(body.expectedRole).toBe('ADMIN');
    expect(body.desiredRole).toBe('STAFF');
  });

  it('대상 역할이 없는데 GRANT/REVOKE를 강제 호출하면 방어적으로 예외를 던진다', () => {
    const admin = detail({ role: 'ADMIN', pendingRequest: null });
    const student = detail({ role: 'STUDENT', pendingRequest: null });

    expect(() =>
      buildAdminAccessPatchRequest(ADMIN_ACCESS_MUTATION_ACTIONS.GRANT, admin),
    ).toThrow();
    expect(() =>
      buildAdminAccessPatchRequest(
        ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE,
        student,
      ),
    ).toThrow();
  });

  it('DEACTIVATE/REACTIVATE는 역할을 유지하고 계정 상태만 뒤집는다', () => {
    const active = detail({ accountStatus: 'ACTIVE', pendingRequest: null });
    const deactivateBody = buildAdminAccessPatchRequest(
      ADMIN_ACCESS_MUTATION_ACTIONS.DEACTIVATE,
      active,
    );
    expect(deactivateBody.desiredRole).toBe(active.role);
    expect(deactivateBody.desiredAccountStatus).toBe('DEACTIVATED');

    const deactivated = detail({
      accountStatus: 'DEACTIVATED',
      pendingRequest: null,
    });
    const reactivateBody = buildAdminAccessPatchRequest(
      ADMIN_ACCESS_MUTATION_ACTIONS.REACTIVATE,
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
      adminAccessMutationSuccessMessage('DEACTIVATE', 'synthetic-target'),
    ).toBe('synthetic-target님에 대한 계정 비활성화 처리를 완료했습니다.');
  });
});
