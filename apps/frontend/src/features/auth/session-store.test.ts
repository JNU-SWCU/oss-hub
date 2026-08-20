import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import { toAccountMenuSession } from './session-view';
import type { AuthSession, Me } from './types';

const fetchSession = vi.fn<() => Promise<AuthSession>>();

vi.mock('./api', () => ({
  fetchSession: () => fetchSession(),
  logout: vi.fn(),
}));

const {
  ensureSessionLoaded,
  getSessionSnapshot,
  refreshSession,
  resetSessionStore,
  subscribeSession,
} = await import('./session-store');

const syntheticUser: Me = {
  nickname: 'synthetic-user',
  name: null,
  email: null,
  avatarUrl: null,
  role: 'STUDENT',
  isProfileComplete: true,
};

function unauthorizedSession(detail: string): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: '로그인이 필요합니다.',
    status: 401,
    detail,
    instance: apiPath('auth/session'),
    code: 'AUT_003',
  });
}

/** 저장소가 in-flight 요청을 끝낼 때까지 microtask를 흘려보낸다. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  resetSessionStore();
  fetchSession.mockReset();
});

describe('공유 인증 세션 저장소', () => {
  it('조회 실패를 error로 게시한다 — 비로그인과 구분한다', async () => {
    fetchSession.mockRejectedValue(new Error('synthetic network failure'));

    ensureSessionLoaded();
    await settle();

    expect(getSessionSnapshot().status).toBe('error');
  });

  it('비로그인 응답은 성공이므로 anonymous로 게시한다', async () => {
    fetchSession.mockResolvedValue({ isAuthenticated: false });

    ensureSessionLoaded();
    await settle();

    expect(getSessionSnapshot().status).toBe('anonymous');
  });

  it('unassigned session은 역할 없는 인증 사용자를 그대로 게시한다', async () => {
    const unassignedUser: Me = { ...syntheticUser, role: null };
    fetchSession.mockResolvedValue({
      isAuthenticated: true,
      user: unassignedUser,
    });

    ensureSessionLoaded();
    await settle();

    expect(getSessionSnapshot()).toEqual({
      status: 'authenticated',
      user: unassignedUser,
    });
  });

  it('authenticated shell consumers share one assigned session', async () => {
    fetchSession.mockResolvedValue({
      isAuthenticated: true,
      user: syntheticUser,
    });
    const shellGate = vi.fn();
    const accountMenu = vi.fn();
    subscribeSession(shellGate);
    subscribeSession(accountMenu);

    ensureSessionLoaded();
    await settle();

    const assignedSession = getSessionSnapshot();
    expect(assignedSession).toEqual({
      status: 'authenticated',
      user: syntheticUser,
    });
    expect(toAccountMenuSession(assignedSession)).toEqual({
      isAuthenticated: true,
      user: syntheticUser,
    });
    expect(shellGate).toHaveBeenCalledOnce();
    expect(accountMenu).toHaveBeenCalledOnce();
  });

  it.each([
    ['401 session', '인증 정보가 없습니다.'],
    ['expired session', '만료된 세션입니다.'],
    ['deactivated account', '비활성 계정입니다.'],
  ])(
    '%s transition clears cached authority to anonymous',
    async (_, detail) => {
      fetchSession.mockResolvedValueOnce({
        isAuthenticated: true,
        user: syntheticUser,
      });
      ensureSessionLoaded();
      await settle();
      expect(getSessionSnapshot().user?.role).toBe('STUDENT');

      const shellGate = vi.fn();
      subscribeSession(shellGate);
      fetchSession.mockRejectedValueOnce(unauthorizedSession(detail));
      refreshSession();

      expect(getSessionSnapshot()).toEqual({ status: 'loading', user: null });
      await settle();
      expect(getSessionSnapshot()).toEqual({ status: 'anonymous', user: null });
      expect(fetchSession).toHaveBeenCalledTimes(2);
      expect(shellGate).toHaveBeenCalledTimes(2);
    },
  );

  // 리뷰에서 지적된 결함: 소비자마다 상태를 따로 들고 있으면 한 화면에서
  // 로그인된 본문과 비로그인 헤더가 동시에 보인다. 저장소를 하나만 두고 모든
  // 구독자가 같은 스냅샷을 받는지 확인한다.
  it('한 곳의 재시도가 모든 구독자를 함께 갱신한다', async () => {
    fetchSession.mockRejectedValueOnce(new Error('synthetic failure'));

    const bodyGate = vi.fn();
    const headerMenu = vi.fn();
    subscribeSession(bodyGate);
    subscribeSession(headerMenu);

    ensureSessionLoaded();
    await settle();
    expect(getSessionSnapshot().status).toBe('error');

    // 엔드포인트가 회복된 뒤 한 소비자에서만 재시도한다.
    fetchSession.mockResolvedValue({
      isAuthenticated: true,
      user: syntheticUser,
    });
    refreshSession();
    await settle();

    const snapshot = getSessionSnapshot();
    expect(snapshot.status).toBe('authenticated');
    expect(snapshot.user).toEqual(syntheticUser);
    // 두 구독자가 모두 통지를 받았다 — 한쪽만 갱신되면 화면 안에서 인증 표시가
    // 서로 모순된다.
    expect(bodyGate).toHaveBeenCalled();
    expect(headerMenu).toHaveBeenCalled();
    // 헤더가 읽는 형태도 함께 회복돼야 한다.
    expect(toAccountMenuSession(snapshot)).toEqual({
      isAuthenticated: true,
      user: syntheticUser,
    });
  });

  it('같은 값이면 스냅샷 참조가 유지된다 — 소비자의 effect 재실행을 막는다', async () => {
    fetchSession.mockResolvedValue({ isAuthenticated: false });

    ensureSessionLoaded();
    await settle();
    const first = getSessionSnapshot();

    ensureSessionLoaded();
    await settle();

    expect(getSessionSnapshot()).toBe(first);
  });

  it('중복 호출은 한 번만 조회한다', async () => {
    fetchSession.mockResolvedValue({ isAuthenticated: false });

    ensureSessionLoaded();
    ensureSessionLoaded();
    await settle();

    expect(fetchSession).toHaveBeenCalledTimes(1);
  });
});

describe('toAccountMenuSession', () => {
  it.each(['loading', 'error'] as const)(
    '%s 상태에서는 계정 메뉴가 아무것도 표시하지 않는다',
    (status) => {
      // error를 anonymous로 표시하면 본문은 오류·재시도를, 헤더는 로그인 버튼을
      // 내걸어 인증 상태가 서로 모순된다.
      expect(toAccountMenuSession({ status, user: null })).toBeNull();
    },
  );

  it('비로그인은 로그인 버튼을 표시한다', () => {
    expect(toAccountMenuSession({ status: 'anonymous', user: null })).toEqual({
      isAuthenticated: false,
    });
  });

  it('로그인 상태는 사용자 정보를 그대로 넘긴다', () => {
    expect(
      toAccountMenuSession({ status: 'authenticated', user: syntheticUser }),
    ).toEqual({ isAuthenticated: true, user: syntheticUser });
  });
});
