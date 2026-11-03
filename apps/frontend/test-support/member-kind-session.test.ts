import { afterEach, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { subscribeSessionInvalidation } from '@/lib/session-invalidation';
import { adminDetail } from '@/features/roles/access-administration/admin-access-detail-test-fixture';
import { runAdminAccessMutation } from '@/features/roles/access-administration/admin-access-mutation-outcome';
afterEach(() => vi.unstubAllGlobals());
it('resets another registration without invalidating the acting administrator session', async () => {
  const invalidated = vi.fn();
  const unsubscribe = subscribeSessionInvalidation(invalidated);
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    expect(input).toBe(apiPath('users/target/member-kind/reset'));
    expect(init?.method).toBe('POST');
    if (typeof init?.body !== 'string')
      throw new TypeError('Missing request body');
    expect(JSON.parse(init.body)).toEqual({
      expectedMemberKind: 'STAFF',
      expectedApprovalStatus: 'PENDING',
      expectedApprovalRequestId: 'observed-request',
    });
    return Promise.resolve(
      Response.json({
        id: 'target',
        role: null,
        memberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: false,
        approvalStatus: 'NOT_REQUIRED',
        approvalRequestId: null,
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    expect(
      await runAdminAccessMutation({
        userId: 'target',
        action: 'RESET_MEMBER_KIND',
        detail: adminDetail({
          isSelf: false,
          memberKind: 'STAFF',
          hasAdminAccess: false,
          hasStaffAccess: false,
          approvalStatus: 'PENDING',
          approvalRequestId: 'observed-request',
        }),
        reason: '',
      }),
    ).toEqual({ kind: 'success', result: null });
    expect(invalidated).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally {
    unsubscribe();
  }
});
it('shows a rejected reset without retrying or approving a replacement request', async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      Response.json(
        {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          code: 'ROL_013',
          detail: 'Synthetic stale request',
          instance: apiPath('users/target/member-kind/reset'),
        },
        { status: 409 },
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  expect(
    await runAdminAccessMutation({
      userId: 'target',
      action: 'RESET_MEMBER_KIND',
      detail: adminDetail({
        isSelf: false,
        memberKind: 'STAFF',
        approvalStatus: 'PENDING',
        approvalRequestId: 'observed-request',
      }),
      reason: '',
    }),
  ).toEqual({ kind: 'error', message: 'Synthetic stale request' });
  expect(fetchMock).toHaveBeenCalledOnce();
});
