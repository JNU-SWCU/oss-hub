import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memberSurfaces } from '@/app/_shell/member-access';
import {
  ensureSessionLoaded,
  getSessionSnapshot,
  refreshSession,
  resetSessionStore,
  subscribeSession,
} from '@/features/auth/session-store';
import type { Me } from '@/features/auth/types';
import { apiPath } from '@/lib/api-client';
import { subscribeSessionInvalidation } from '@/lib/session-invalidation';
import { adminDetail } from '@/features/roles/access-administration/admin-access-detail-test-fixture';
import { runAdminAccessMutation } from '@/features/roles/access-administration/admin-access-mutation-outcome';

const student: Me = {
  nickname: 'synthetic-admin',
  name: '합성 관리자',
  email: null,
  avatarUrl: null,
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: true,
  isProfileComplete: true,
};
const staff: Me = { ...student, memberKind: 'STAFF', hasStaffAccess: true };

function nextSession(): Promise<Me> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new TypeError('Session refresh did not publish a member'));
    }, 1_000);
    const unsubscribe = subscribeSession(() => {
      const snapshot = getSessionSnapshot();
      if (snapshot.status !== 'authenticated' || snapshot.user === null) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(snapshot.user);
    });
  });
}

let unsubscribe: (() => void) | undefined;
beforeEach(() => {
  resetSessionStore();
  unsubscribe = subscribeSessionInvalidation(refreshSession);
});
afterEach(() => {
  unsubscribe?.();
  resetSessionStore();
  vi.unstubAllGlobals();
});

describe('actual administrator identity changes', () => {
  it.each([
    {
      before: student,
      after: staff,
      action: 'SET_MEMBER_STAFF',
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      surfaces: ['staff', 'admin'],
    },
    {
      before: staff,
      after: student,
      action: 'SET_MEMBER_STUDENT',
      approvalStatus: 'APPROVED',
      approvalRequestId: 'approved-request',
      surfaces: ['student', 'admin'],
    },
  ] as const)('refreshes navigation after $action', async (scenario) => {
    let sessionUser = scenario.before;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url === apiPath('auth/session')) {
          return Response.json({ isAuthenticated: true, user: sessionUser });
        }
        expect(url).toBe(apiPath('users/target/member-kind'));
        expect(init?.method).toBe('PATCH');
        if (typeof init?.body !== 'string')
          throw new TypeError('Expected a JSON request body');
        const body: unknown = JSON.parse(init.body);
        expect(body).toMatchObject({
          expectedMemberKind: scenario.before.memberKind,
          expectedHasStaffAccess: scenario.before.hasStaffAccess,
          expectedApprovalStatus: scenario.approvalStatus,
          expectedApprovalRequestId: scenario.approvalRequestId,
        });
        sessionUser = scenario.after;
        return Response.json({
          id: 'target',
          role: 'ADMIN',
          ...sessionUser,
          approvalStatus: sessionUser.hasStaffAccess
            ? 'APPROVED'
            : 'NOT_REQUIRED',
          approvalRequestId: sessionUser.hasStaffAccess
            ? 'approved-request'
            : null,
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const loaded = nextSession();
    ensureSessionLoaded();
    await loaded;
    const refreshed = nextSession();

    const outcome = await runAdminAccessMutation({
      userId: 'target',
      action: scenario.action,
      detail: adminDetail({
        ...scenario.before,
        isSelf: true,
        approvalStatus: scenario.approvalStatus,
        approvalRequestId: scenario.approvalRequestId,
      }),
      reason: '',
    });

    expect(outcome.kind).toBe('success');
    expect(memberSurfaces(await refreshed)).toEqual(scenario.surfaces);
  });

  it('does not approve or retry a replacement request after a stale 409', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          code: 'ROL_013',
          detail: 'Approval request replaced',
          instance: apiPath('users/target/member-kind'),
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await runAdminAccessMutation({
      userId: 'target',
      action: 'SET_MEMBER_STAFF',
      detail: adminDetail({
        isSelf: true,
        memberKind: 'STAFF',
        hasStaffAccess: false,
        approvalStatus: 'PENDING',
        approvalRequestId: 'observed-request',
      }),
      reason: '',
    });

    expect(outcome).toEqual({ kind: 'conflict', projection: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSessionSnapshot().status).toBe('loading');
  });
});
