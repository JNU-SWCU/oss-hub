import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMyStaffAccessRequest, fetchMyRoleSelection } from './api';

describe('fetchMyStaffAccessRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('본문 없는 200을 역할 요청 없음(null)으로 읽는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );

    await expect(fetchMyStaffAccessRequest()).resolves.toBeNull();
  });

  it('요청이 있으면 그 상태를 그대로 돌려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestedRole: 'STAFF',
            status: 'PENDING',
            requestedAt: '2026-08-03T00:00:00.000Z',
            decidedAt: null,
            rejectionReason: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(fetchMyStaffAccessRequest()).resolves.toMatchObject({
      status: 'PENDING',
    });
  });
});

describe('fetchMyRoleSelection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respond(body: string | null) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          ...(body === null
            ? {}
            : { headers: { 'Content-Type': 'application/json' } }),
        }),
      ),
    );
  }

  it.each(['STUDENT', 'STAFF'] as const)(
    '%s 선택을 그대로 읽는다',
    async (selectedRole) => {
      respond(JSON.stringify({ selectedRole }));

      await expect(fetchMyRoleSelection()).resolves.toEqual({ selectedRole });
    },
  );

  it('아직 고르지 않았으면 null로 읽는다', async () => {
    respond(JSON.stringify({ selectedRole: null }));

    await expect(fetchMyRoleSelection()).resolves.toEqual({
      selectedRole: null,
    });
  });

  it('본문 없는 200도 고르지 않음으로 읽는다', async () => {
    respond(null);

    await expect(fetchMyRoleSelection()).resolves.toEqual({
      selectedRole: null,
    });
  });

  it.each(['ADMIN', '', 'student', 42])(
    '모르는 값(%s)은 고르지 않음으로 접는다',
    async (selectedRole) => {
      respond(JSON.stringify({ selectedRole }));

      await expect(fetchMyRoleSelection()).resolves.toEqual({
        selectedRole: null,
      });
    },
  );

  it('고른 역할만 남기고 redirectTo·요청 필드는 투영하지 않는다', async () => {
    respond(
      JSON.stringify({
        selectedRole: 'STAFF',
        redirectTo: '/dashboard',
        requestedRole: 'ADMIN',
      }),
    );

    const state = await fetchMyRoleSelection();
    expect(state).toEqual({ selectedRole: 'STAFF' });
    expect(state).not.toHaveProperty('redirectTo');
    expect(state).not.toHaveProperty('requestedRole');
  });
});
