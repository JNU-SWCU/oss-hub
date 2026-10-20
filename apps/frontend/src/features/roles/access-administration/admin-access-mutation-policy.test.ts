import { describe, expect, it } from 'vitest';
import type {
  AdminAccessHistory,
  AdminAccessLoginHistoryItem,
  AdminAccessStaffAccessRequestHistoryItem,
} from './admin-access-api';
import {
  actionForAccountStatus,
  adminAccessMutationSuccessMessage,
  applyAdminAccessDecidedRequestToHistory,
  buildAdminAccessPatchRequest,
  buildMemberKindMutationRequest,
  isIndependentAuthorityMutationAction,
  isMemberKindMutationAction,
} from './admin-access-mutation-policy';
import type { CanonicalAdminAccessDetail } from './independent-authority-api';

function detail(
  overrides: Partial<CanonicalAdminAccessDetail> = {},
): CanonicalAdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'synthetic-target',
    name: '합성 사용자',
    role: 'STAFF',
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    createdAt: '2026-07-29T00:00:00.000Z',
    pendingRequest: null,
    lastLoginAt: null,
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      staffNumber: null,
      department: '인공지능학부',
      isComplete: true,
    },
    ...overrides,
  };
}

describe('independent authority mutation policy', () => {
  it.each(['GRANT_ADMIN_ACCESS', 'REVOKE_ADMIN_ACCESS'] as const)(
    'classifies the exact Task 8 action %s',
    (action) => {
      expect(isIndependentAuthorityMutationAction(action)).toBe(true);
    },
  );

  it.each(['SET_MEMBER_STUDENT', 'SET_MEMBER_STAFF'] as const)(
    'classifies member-kind action %s separately from admin authority',
    (action) => {
      expect(isMemberKindMutationAction(action)).toBe(true);
      expect(isIndependentAuthorityMutationAction(action)).toBe(false);
    },
  );

  it.each(['APPROVE', 'REJECT', 'SET_STATUS_ACTIVE'] as const)(
    'does not classify legacy non-authority action %s',
    (action) => {
      expect(isIndependentAuthorityMutationAction(action)).toBe(false);
    },
  );

  it('builds a member-kind payload from canonical fields only', () => {
    expect(
      buildMemberKindMutationRequest('SET_MEMBER_STAFF', detail(), {
        staffNumber: 'staff-42',
      }),
    ).toEqual({
      memberKind: 'STAFF',
      expectedMemberKind: 'STUDENT',
      expectedHasStaffAccess: false,
      staffNumber: 'staff-42',
    });
  });

  it('requires an explicit canonical member kind instead of inferring from role', () => {
    expect(() =>
      buildMemberKindMutationRequest(
        'SET_MEMBER_STUDENT',
        detail({ memberKind: null }),
      ),
    ).toThrow('existing canonical member kind');
  });

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
      adminAccessMutationSuccessMessage('SET_MEMBER_STAFF', 'synthetic-target'),
    ).toContain('교직원 유형 적용');
  });
});

const PENDING_ROW: AdminAccessStaffAccessRequestHistoryItem = {
  id: 'request-1',
  status: 'PENDING',
  rejectionReason: null,
  decidedAt: null,
  decidedBy: null,
  createdAt: '2026-08-21T00:00:00.000Z',
};

const OTHER_ROW: AdminAccessStaffAccessRequestHistoryItem = {
  id: 'request-0',
  status: 'REJECTED',
  rejectionReason: '이전 반려 사유',
  decidedAt: '2026-08-20T00:00:00.000Z',
  decidedBy: 'seed-auth-admin',
  createdAt: '2026-08-19T00:00:00.000Z',
};

const LOGIN_ROW: AdminAccessLoginHistoryItem = {
  id: 'login-1',
  event: 'LOGIN',
  provider: 'github',
  success: true,
  loginAt: '2026-08-21T01:00:00.000Z',
};

function history(
  items: readonly AdminAccessStaffAccessRequestHistoryItem[] = [
    PENDING_ROW,
    OTHER_ROW,
  ],
): AdminAccessHistory {
  return {
    staffAccessRequests: { items, page: 1, limit: 20, total: items.length },
    loginHistory: { items: [LOGIN_ROW], page: 1, limit: 20, total: 1 },
  };
}

describe('applyAdminAccessDecidedRequestToHistory', () => {
  it('updates only the matching row status when the backend decided it', () => {
    const before = history();

    const after = applyAdminAccessDecidedRequestToHistory(before, {
      id: 'request-1',
      status: 'APPROVED',
    });

    expect(after.staffAccessRequests.items[0]).toEqual({
      ...PENDING_ROW,
      status: 'APPROVED',
    });
    expect(after.staffAccessRequests.items[1]).toEqual(OTHER_ROW);
    expect(after.staffAccessRequests.total).toBe(2);
  });

  it('never fabricates decidedAt/decidedBy/rejectionReason for the decided row', () => {
    const after = applyAdminAccessDecidedRequestToHistory(history(), {
      id: 'request-1',
      status: 'REJECTED',
    });

    const decided = after.staffAccessRequests.items[0];
    expect(decided?.decidedAt).toBeNull();
    expect(decided?.decidedBy).toBeNull();
    expect(decided?.rejectionReason).toBeNull();
    expect(decided?.createdAt).toBe(PENDING_ROW.createdAt);
  });

  it('is a no-op when the mutation decided no request', () => {
    const before = history();
    const after = applyAdminAccessDecidedRequestToHistory(before, null);

    expect(after).toBe(before);
  });

  it('is a no-op when the decided id is absent from the visible page', () => {
    const before = history();
    const after = applyAdminAccessDecidedRequestToHistory(before, {
      id: 'request-on-another-page',
      status: 'APPROVED',
    });

    expect(after).toBe(before);
  });

  it('leaves login history untouched', () => {
    const before = history();
    const after = applyAdminAccessDecidedRequestToHistory(before, {
      id: 'request-1',
      status: 'APPROVED',
    });

    expect(after.loginHistory).toBe(before.loginHistory);
  });
});
