import { describe, expect, it } from 'vitest';
import type {
  AdminAccessDetail,
  AdminAccessHistory,
  AdminAccessLoginHistoryItem,
  AdminAccessStaffAccessRequestHistoryItem,
} from './admin-access-api';
import {
  actionForAccountStatus,
  adminAccessMutationSuccessMessage,
  applyAdminAccessDecidedRequestToHistory,
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
    // Given: a history page whose first row is the still-PENDING request.
    const before = history();

    // When: the authoritative mutation response says that row was approved.
    const after = applyAdminAccessDecidedRequestToHistory(before, {
      id: 'request-1',
      status: 'APPROVED',
    });

    // Then: only that row's status changed; siblings keep their identity.
    expect(after.staffAccessRequests.items[0]).toEqual({
      ...PENDING_ROW,
      status: 'APPROVED',
    });
    expect(after.staffAccessRequests.items[1]).toEqual(OTHER_ROW);
    expect(after.staffAccessRequests.total).toBe(2);
  });

  it('never fabricates decidedAt/decidedBy/rejectionReason for the decided row', () => {
    // Given / When: the same decision applied to a row with no audit fields.
    const after = applyAdminAccessDecidedRequestToHistory(history(), {
      id: 'request-1',
      status: 'REJECTED',
    });

    // Then: server-owned audit columns stay exactly as the server left them.
    const decided = after.staffAccessRequests.items[0];
    expect(decided?.decidedAt).toBeNull();
    expect(decided?.decidedBy).toBeNull();
    expect(decided?.rejectionReason).toBeNull();
    expect(decided?.createdAt).toBe(PENDING_ROW.createdAt);
  });

  it('is a no-op when the mutation decided no request', () => {
    // Given / When
    const before = history();
    const after = applyAdminAccessDecidedRequestToHistory(before, null);

    // Then
    expect(after).toBe(before);
  });

  it('is a no-op when the decided id is absent from the visible page', () => {
    // Given / When
    const before = history();
    const after = applyAdminAccessDecidedRequestToHistory(before, {
      id: 'request-on-another-page',
      status: 'APPROVED',
    });

    // Then: 보이는 페이지에 그 행이 없으면 새 객체를 만들지도 않고 원본을 돌려준다
    // — 구조가 같기만 한 사본은 조기 반환을 지워도 통과해 버려 잡지 못한다.
    expect(after).toBe(before);
  });

  it('leaves login history untouched', () => {
    // Given / When
    const before = history();
    const after = applyAdminAccessDecidedRequestToHistory(before, {
      id: 'request-1',
      status: 'APPROVED',
    });

    // Then
    expect(after.loginHistory).toBe(before.loginHistory);
  });
});
