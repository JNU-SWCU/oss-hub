import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMyRoleRequest, fetchMyRoleSelection } from './api';

/**
 * 역할 요청이 아직 없는 사용자 — 갓 가입한 사람이 여기 해당한다.
 *
 * 백엔드(`GET /api/v1/role-requests/me`)는 그 사용자에게 본문 없는 200을 보낸다.
 * Nest가 handler의 `null`을 본문 없음으로 옮기기 때문이다. 이 조회가 거절되면
 * `useSessionRole`이 세션 상태를 `error`로 두고, 모든 게이트가 "로그인 정보를
 * 확인하지 못했습니다" 화면으로 접혀 가입 동선이 첫 화면에서 끊긴다.
 *
 * 그래서 여기서는 Response를 실물 그대로 세워 놓고 검사한다 — `apiClient`를
 * 대역으로 바꾸면 정확히 이 지점(본문 없는 200을 어떻게 읽는가)이 사라진다.
 */
describe('fetchMyRoleRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('본문 없는 200을 역할 요청 없음(null)으로 읽는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );

    await expect(fetchMyRoleRequest()).resolves.toBeNull();
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

    await expect(fetchMyRoleRequest()).resolves.toMatchObject({
      status: 'PENDING',
    });
  });
});

/**
 * 고른 역할 조회(#569).
 *
 * 이 값이 프로필 화면의 필수 항목을 정하므로, **아는 값만 통과시킨다.** 여기서도
 * `apiClient`를 대역으로 바꾸지 않고 Response를 실물 그대로 세운다 — 본문 없는 200을
 * 어떻게 읽는지가 실배포에서 신규 가입을 통째로 막은 적이 있다(PR #531).
 */
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
    // 앞뒤 배포가 어긋나 이 경로가 아직 없을 수 있다. 그때 던지면 게이트가 세션을
    // `error`로 두고 가입 동선이 첫 화면에서 끊긴다.
    respond(null);

    await expect(fetchMyRoleSelection()).resolves.toEqual({
      selectedRole: null,
    });
  });

  it.each(['ADMIN', '', 'student', 42])(
    '모르는 값(%s)은 고르지 않음으로 접는다',
    async (selectedRole) => {
      // 모르는 문자열을 그대로 흘리면 화면이 그것을 "어떤 역할"로 취급해 필수 항목을
      // 잘못 계산한다. 접어 두면 그 사용자는 역할 선택으로 되돌아가 다시 고르면 된다.
      respond(JSON.stringify({ selectedRole }));

      await expect(fetchMyRoleSelection()).resolves.toEqual({
        selectedRole: null,
      });
    },
  );
});
