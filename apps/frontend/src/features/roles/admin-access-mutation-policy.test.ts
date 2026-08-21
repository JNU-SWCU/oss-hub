import { describe, expect, it } from 'vitest';
import type { AdminAccessDetail } from './admin-access-api';
import {
  actionForAccountStatus,
  adminAccessMutationSuccessMessage,
  buildAdminAccessPatchRequest,
  isIndependentAuthorityMutationAction,
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
    lastLoginAt: null,
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      department: '인공지능학부',
      isComplete: true,
    },
    ...overrides,
  };
}

describe('independent authority mutation policy', () => {
  it.each([
    'GRANT_STAFF_ACCESS',
    'REVOKE_STAFF_ACCESS',
    'GRANT_ADMIN_ACCESS',
    'REVOKE_ADMIN_ACCESS',
  ] as const)('classifies the exact Task 8 action %s', (action) => {
    expect(isIndependentAuthorityMutationAction(action)).toBe(true);
  });

  it.each(['APPROVE', 'REJECT', 'SET_STATUS_ACTIVE'] as const)(
    'does not classify legacy non-authority action %s',
    (action) => {
      expect(isIndependentAuthorityMutationAction(action)).toBe(false);
    },
  );

  it('keeps account status on the legacy CAS resource', () => {
    expect(
      buildAdminAccessPatchRequest('SET_STATUS_DEACTIVATED', detail()),
    ).toEqual({
      expectedRole: 'STAFF',
      expectedAccountStatus: 'ACTIVE',
      expectedPendingRequest: null,
      desiredRole: 'STAFF',
      desiredAccountStatus: 'DEACTIVATED',
    });
  });

  it('keeps request approval on the legacy CAS resource', () => {
    const source = detail({
      pendingRequest: {
        id: 'request-1',
        status: 'PENDING',
        createdAt: '2026-08-21T00:00:00.000Z',
      },
    });
    expect(buildAdminAccessPatchRequest('APPROVE', source)).toMatchObject({
      expectedPendingRequest: { id: 'request-1', status: 'PENDING' },
      requestDecision: { decision: 'APPROVE' },
    });
  });

  it('maps account status buttons without authority aliases', () => {
    expect(actionForAccountStatus('ACTIVE')).toBe('SET_STATUS_ACTIVE');
    expect(actionForAccountStatus('DEACTIVATED')).toBe(
      'SET_STATUS_DEACTIVATED',
    );
  });

  it('uses independent authority success copy', () => {
    expect(
      adminAccessMutationSuccessMessage(
        'REVOKE_STAFF_ACCESS',
        'synthetic-target',
      ),
    ).toContain('교직원 접근 회수');
  });
});
