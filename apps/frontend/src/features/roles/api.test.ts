import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMyRoleRequest } from './api';

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
