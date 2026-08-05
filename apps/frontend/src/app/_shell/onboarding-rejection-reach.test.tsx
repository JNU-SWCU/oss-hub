// @vitest-environment happy-dom

import { Component, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoleRequest, RoleRequestStatus } from '@/features/roles/types';

/**
 * 반려 사유가 **사용자 눈에 닿는가**를 라우팅 전체로 확인한다(#673).
 *
 * 왜 이 계층이 따로 필요한가. 사유를 그리는 화면은 이미 있었고 단위 테스트도 있었다
 * (`features/roles/role-onboarding.test.tsx`의 `RoleRequestStatusView` 검사).
 * 그 테스트는 컴포넌트를 **직접 렌더**한다 — 페이지도 게이트도 거치지 않는다.
 * 그래서 #535가 반려 사용자의 목적지를 `/onboarding/pending`에서
 * `/onboarding/role`로 옮겼을 때, 사유를 그리는 화면이 도달 불가가 됐는데도 모든
 * 테스트가 초록불이었다. 컴포넌트가 옳게 그리는지는 검사했지만 **그 컴포넌트에
 * 사용자가 도달하는지는 아무도 검사하지 않았다.**
 *
 * 그래서 이 파일은 특정 경로를 못박지 않는다. `/onboarding/pending` ·
 * `/onboarding/profile` · `/onboarding/role` 셋을 실제 게이트째 마운트해 놓고,
 * **적어도 한 도달 가능 화면에 사유가 실제로 DOM에 나타난다**만 단언한다. 라우팅이
 * 또 바뀌어도 사유를 잃는 순간에만 빨간불이 되고, 목적지가 어디로 옮겨 가든 옮겨
 * 갔다는 이유만으로는 깨지지 않는다.
 *
 * 가짜는 네트워크 경계에만 세운다 — 게이트·화면·세션 조합(`useSessionRole`)이
 * 전부 진짜로 돌아야 "도달"을 검사한 것이 된다.
 */

const REJECTION_REASON = '합성 반려 사유 — 소속 학과가 확인되지 않았습니다.';
const REJECTION_HEADLINE = '교직원 요청이 반려되었습니다';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
  fetchMyRoleRequest: vi.fn(),
  fetchMyRoleSelection: vi.fn(),
  selectRole: vi.fn(),
  requestStaffRole: vi.fn(),
  getMyProfile: vi.fn(),
  useSession: vi.fn(),
}));

/**
 * `useRouter`가 **호출마다 같은 객체**를 돌려줘야 한다.
 *
 * 새 객체를 만들면 그 값을 `useCallback`·`useEffect` 의존성으로 쓰는 게이트가 매
 * 렌더 effect를 다시 걸어 무한 루프가 된다. 이 저장소는 그것 때문에 CI가 힙 부족으로
 * 죽은 적이 있고, 증상은 `ERR_IPC_CHANNEL_CLOSED`로 위장돼 원인이 보이지 않았다.
 */
const ROUTER = {
  replace: mocks.replace,
  push: mocks.push,
  refresh: mocks.refresh,
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
};

/** `redirect()`는 실제로 렌더를 중단시킨다 — 그 성질까지 흉내 내야 화면이 이어 그려지지 않는다. */
class RedirectSignal extends Error {
  constructor(readonly path: string) {
    super(`NEXT_REDIRECT:${path}`);
  }
}

vi.mock('next/navigation', () => ({
  useRouter: () => ROUTER,
  redirect: (path: string) => {
    mocks.redirect(path);
    throw new RedirectSignal(path);
  },
}));

vi.mock('@/features/roles/api', () => ({
  fetchMyRoleRequest: mocks.fetchMyRoleRequest,
  fetchMyRoleSelection: mocks.fetchMyRoleSelection,
  selectRole: mocks.selectRole,
  requestStaffRole: mocks.requestStaffRole,
}));

vi.mock('@/features/profile/api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/profile/api')>();
  return { ...actual, getMyProfile: mocks.getMyProfile };
});

vi.mock('@/features/auth/use-session', () => ({
  useSession: mocks.useSession,
}));

import OnboardingPendingPage from '../onboarding/pending/page';
import OnboardingProfilePage from '../onboarding/profile/page';
import OnboardingRolePage from '../onboarding/role/page';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/**
 * `redirect()`가 던지는 중단 신호를 받아 낸다. 경계가 없으면 React가 트리를 통째로
 * 버리면서 오류를 다시 던져, 검사하려던 것과 무관한 실패로 보인다.
 */
class RedirectBoundary extends Component<
  { readonly children: ReactNode },
  { readonly redirected: boolean }
> {
  state = { redirected: false };

  static getDerivedStateFromError(error: unknown) {
    if (error instanceof RedirectSignal) {
      return { redirected: true };
    }
    throw error;
  }

  render() {
    return this.state.redirected ? null : this.props.children;
  }
}

/** 승인 전 교직원은 세션에 역할이 없다 — 그 사람이 이 사각지대의 주인공이다. */
const AUTHENTICATED_SESSION = {
  status: 'authenticated' as const,
  user: {
    nickname: 'synthetic-staff-applicant',
    name: '합성 교직원 사용자',
    email: null,
    avatarUrl: null,
    role: null,
    isProfileComplete: true,
  },
  retry: () => {},
};

const COMPLETE_PROFILE = {
  name: '합성 교직원 사용자',
  studentId: null,
  department: '인공지능학부',
  isComplete: true,
};

/** 온보딩 게이트가 지키는 세 화면 전부. 하나라도 빠지면 "어디에도 없다"를 증명하지 못한다. */
const ONBOARDING_SCREENS = [
  ['/onboarding/pending', OnboardingPendingPage],
  ['/onboarding/profile', OnboardingProfilePage],
  ['/onboarding/role', OnboardingRolePage],
] as const satisfies readonly (readonly [string, () => ReactNode])[];

function roleRequest(overrides: Partial<RoleRequest> = {}): RoleRequest {
  return {
    requestedRole: 'STAFF',
    status: 'PENDING',
    requestedAt: '2026-07-30T02:00:00.000Z',
    decidedAt: null,
    rejectionReason: null,
    ...overrides,
  };
}

describe('반려 사유 도달 가능성', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    // 스냅샷은 참조가 안정적이어야 한다(위 `ROUTER`와 같은 이유).
    mocks.useSession.mockReturnValue(AUTHENTICATED_SESSION);
    mocks.fetchMyRoleSelection.mockResolvedValue({ selectedRole: null });
    mocks.getMyProfile.mockResolvedValue(COMPLETE_PROFILE);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container, {
      // 이 파일이 일부러 던지는 이동 신호까지 실패로 시끄럽게 만들지 않는다.
      onCaughtError: () => {},
      onUncaughtError: () => {},
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  interface MountedScreen {
    /** 그 화면이 실제로 그린 본문. 되돌려 보내진 화면은 사실상 비어 있다. */
    readonly text: string;
    /** 마운트하는 동안 이 화면이 사용자를 어디로 밀어냈는가. 비어 있어야 "도달"이다. */
    readonly redirects: readonly string[];
  }

  /** 세 화면을 차례로 게이트째 마운트해, 각 화면이 그린 본문과 이동을 함께 모은다. */
  async function mountEveryOnboardingScreen(): Promise<
    ReadonlyMap<string, MountedScreen>
  > {
    const rendered = new Map<string, MountedScreen>();
    for (const [path, Screen] of ONBOARDING_SCREENS) {
      // 이동은 화면마다 따로 센다 — 앞 화면이 부른 이동을 뒤 화면의 것으로 읽으면
      // "밀려나면서 스친 것"과 "머물러 읽은 것"을 구분하지 못한다.
      mocks.replace.mockClear();
      mocks.redirect.mockClear();
      await act(async () =>
        root.render(
          <RedirectBoundary>
            <Screen />
          </RedirectBoundary>,
        ),
      );
      rendered.set(path, {
        text: container.textContent ?? '',
        redirects: [
          ...mocks.replace.mock.calls.map(([target]) => String(target)),
          ...mocks.redirect.mock.calls.map(([target]) => String(target)),
        ],
      });
      await act(async () => root.render(<></>));
    }
    return rendered;
  }

  /**
   * 이 파일의 핵심 단언.
   *
   * 목적지를 못박지 않는 이유는 #535 같은 결정이 또 내려질 수 있기 때문이다. 목적지는
   * 바뀌어도 되지만, **어느 목적지든 사유는 실려 있어야 한다.**
   */
  it('반려 사용자는 도달 가능한 온보딩 화면에서 반려 사유를 읽는다', async () => {
    // Given: 사유가 붙은 반려 요청.
    mocks.fetchMyRoleRequest.mockResolvedValue(
      roleRequest({
        status: 'REJECTED',
        decidedAt: '2026-07-31T05:00:00.000Z',
        rejectionReason: REJECTION_REASON,
      }),
    );

    // When
    const rendered = await mountEveryOnboardingScreen();

    // Then: 셋 중 적어도 하나가, 되돌려 보내지지 않은 채로 사유를 실제로 그렸다.
    // 밀려나면서 스친 것은 도달이 아니므로 이동이 하나도 없어야 한다.
    const reached = [...rendered.entries()].filter(
      ([, screen]) =>
        screen.text.includes(REJECTION_REASON) && screen.redirects.length === 0,
    );
    expect(reached.map(([path]) => path)).not.toHaveLength(0);
  });

  /**
   * 반려됐다는 **사실**도 함께 닿아야 한다. 사유 문장만 있고 무슨 일이 일어난
   * 것인지 없으면, 처음 가입할 때와 같은 화면에 낯선 문장 하나가 붙은 것으로 읽힌다.
   */
  it('사유가 비어 있어도 반려됐다는 사실은 도달한다', async () => {
    // Given: 사유 없이 닫힌 과거 반려 건.
    mocks.fetchMyRoleRequest.mockResolvedValue(
      roleRequest({
        status: 'REJECTED',
        decidedAt: '2026-07-31T05:00:00.000Z',
        rejectionReason: null,
      }),
    );

    // When
    const rendered = await mountEveryOnboardingScreen();

    // Then
    const texts = [...rendered.values()].map((screen) => screen.text);
    expect(texts.some((text) => text.includes(REJECTION_HEADLINE))).toBe(true);
    // 빈 사유 상자를 그리지 않는다 — 라벨만 뜨고 안이 비면 아직 안 온 줄 알고 기다린다.
    expect(texts.some((text) => text.includes('반려 사유'))).toBe(false);
  });

  /**
   * 반려가 아닌 사용자의 화면은 그대로다. 안내가 상태와 무관하게 늘 뜨면, 처음
   * 가입하는 사람이 반려된 적도 없이 반려 안내를 본다.
   */
  it.each([
    ['요청 없음', null],
    ['승인 대기', 'PENDING'],
    ['회수', 'REVOKED'],
  ] as readonly (readonly [string, RoleRequestStatus | null])[])(
    '%s 사용자에게는 반려 안내가 어느 화면에도 없다',
    async (_label, status) => {
      // Given
      mocks.fetchMyRoleRequest.mockResolvedValue(
        status === null ? null : roleRequest({ status }),
      );

      // When
      const rendered = await mountEveryOnboardingScreen();

      // Then
      for (const { text } of rendered.values()) {
        expect(text).not.toContain(REJECTION_HEADLINE);
        expect(text).not.toContain(REJECTION_REASON);
      }
    },
  );

  /**
   * 재요청이 접수되면 안내가 사라진다. 남아 있으면 방금 다시 신청한 사람이 여전히
   * 반려 상태인 줄 알고 또 신청한다.
   */
  it('재요청이 접수돼 승인 대기가 되면 반려 안내가 사라진다', async () => {
    // Given: 방금까지 반려였다가 재요청이 접수된 사람.
    mocks.fetchMyRoleRequest.mockResolvedValue(
      roleRequest({ status: 'PENDING' }),
    );

    // When
    const rendered = await mountEveryOnboardingScreen();

    // Then
    for (const { text } of rendered.values()) {
      expect(text).not.toContain(REJECTION_HEADLINE);
    }
  });
});
