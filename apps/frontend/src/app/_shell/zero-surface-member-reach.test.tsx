// @vitest-environment happy-dom

import { Component, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 면이 하나도 없는 회원이 실제 화면에서 막다른 골목에 갇히지 않는지 확인한다.
 *
 * 분류 자체는 `zero-surface-member-classification.test.tsx`가 못 박는다. 그런데 분류만
 * 검사하면 라우팅이 실제로 이어지는지는 알 수 없다 — 이 저장소는 그 틈에서 정확히
 * 한 번 데었다(#673: 컴포넌트가 옳게 그리는지는 검사했지만 **그 컴포넌트에 사용자가
 * 도달하는지는 아무도 검사하지 않았다**).
 *
 * 그래서 여기서는 셸과 페이지를 게이트째 마운트해 세 가지를 묻는다.
 *
 * 1. 열 수 없는 화면으로 가는 입구(상단 「대시보드」)를 만들지 않는가.
 * 2. 그 경로에 직접 닿아도 "접근 권한이 없는 페이지" → 돌아가기가 다시 그 경로인
 *    닫힌 고리가 되지 않는가.
 * 3. 승인을 기다리는 교직원의 설정 예외(#581)는 그대로 열리는가.
 * 4. 승인 기록만 남고 권한은 없는 사람이 두 화면 사이를 오가지 않는가.
 *
 * 가짜는 네트워크 경계(`/auth/session`·역할 요청·프로필·알림 채널)에만 세운다 —
 * 훅·게이트·셸이 전부 진짜로 돌아야 "도달"을 검사한 것이 된다.
 */

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  usePathname: vi.fn(() => '/dashboard'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  fetchMyStaffAccessRequest: vi.fn(),
  fetchMyRoleSelection: vi.fn(),
  getMyProfile: vi.fn(),
  getMyNotificationChannel: vi.fn(),
  useSession: vi.fn(),
}));

/** 호출마다 같은 객체여야 한다 — 새 객체를 주면 게이트의 effect가 매 렌더 다시 걸린다. */
const ROUTER = {
  replace: mocks.replace,
  push: mocks.push,
  refresh: mocks.refresh,
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => ROUTER,
  usePathname: mocks.usePathname,
  useSearchParams: mocks.useSearchParams,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/features/roles/api', () => ({
  fetchMyStaffAccessRequest: mocks.fetchMyStaffAccessRequest,
  fetchMyRoleSelection: mocks.fetchMyRoleSelection,
  selectRole: vi.fn(),
  requestStaffRole: vi.fn(),
}));

vi.mock('@/features/profile/api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/profile/api')>();
  return { ...actual, getMyProfile: mocks.getMyProfile };
});

/**
 * 설정 화면이 열리면 알림 채널을 따로 읽는다 — 가짜를 안 세우면 진짜 소켓이 열려
 * 검사가 환경의 네트워크에 따라 흔들린다.
 */
vi.mock(
  '@/features/profile/settings/notification-channel-api',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/features/profile/settings/notification-channel-api')
      >();
    return {
      ...actual,
      getMyNotificationChannel: mocks.getMyNotificationChannel,
    };
  },
);

vi.mock('@/features/auth/use-session', () => ({
  useSession: mocks.useSession,
}));

import { AppFrame } from './app-frame';
import { onboardingPathFor } from './onboarding-route';
import DashboardPage from '../dashboard/page';
import OnboardingPendingPage from '../onboarding/pending/page';
import SettingsPage from '../settings/page';
import { SETTINGS_ONBOARDING_NOTICE_HEADING } from '../settings/settings-onboarding-notice';
import {
  ACCESS_DENIED_HEADING,
  ASSIGNED_PERSONAS,
  authenticatedSession,
  staffAccessRequest,
  ZERO_SURFACE_STAFF,
} from './zero-surface-member-test-support';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/** 게이트가 던지는 이동 신호까지 실패로 시끄럽게 만들지 않는다. */
class ErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

describe('면이 없는 회원의 화면 도달', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePathname.mockReturnValue('/dashboard');
    mocks.fetchMyRoleSelection.mockResolvedValue({ selectedRole: null });
    mocks.fetchMyStaffAccessRequest.mockResolvedValue(null);
    mocks.getMyProfile.mockResolvedValue({
      name: '합성 사용자',
      studentId: null,
      department: '인공지능학부',
      isComplete: true,
    });
    mocks.getMyNotificationChannel.mockResolvedValue({
      channel: null,
      isVerified: false,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container, {
      onCaughtError: () => {},
      onUncaughtError: () => {},
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** 화면 하나를 게이트째 마운트하고, 그동안 나간 이동과 그려진 본문을 함께 모은다. */
  async function mount(
    screen: ReactNode,
  ): Promise<{ readonly text: string; readonly redirects: readonly string[] }> {
    mocks.replace.mockClear();
    await act(async () => root.render(<ErrorBoundary>{screen}</ErrorBoundary>));
    const result = {
      text: container.textContent ?? '',
      redirects: mocks.replace.mock.calls.map(([target]) => String(target)),
    };
    await act(async () => root.render(<></>));
    return result;
  }

  describe('대시보드 막다른 골목이 없다', () => {
    it('면이 없는 교직원에게는 상단 대시보드 항목을 붙이지 않는다', async () => {
      // Given: 승인을 기다리는 교직원.
      mocks.useSession.mockReturnValue(
        authenticatedSession(ZERO_SURFACE_STAFF),
      );
      mocks.fetchMyStaffAccessRequest.mockResolvedValue(
        staffAccessRequest({ status: 'PENDING' }),
      );

      // When: 공통 셸을 그린다.
      const { text } = await mount(
        <AppFrame brand="OSS Hub" items={[]}>
          <p>본문</p>
        </AppFrame>,
      );

      // Then: 그가 열 수 없는 화면으로 가는 입구를 만들지 않는다.
      expect(text).not.toContain('대시보드');
    });

    it.each(['PENDING', 'REJECTED', 'REVOKED'] as const)(
      '%s 교직원이 /dashboard에 닿으면 안내가 아니라 온보딩으로 보낸다',
      async (status) => {
        // Given
        mocks.useSession.mockReturnValue(
          authenticatedSession(ZERO_SURFACE_STAFF),
        );
        mocks.fetchMyStaffAccessRequest.mockResolvedValue(
          staffAccessRequest({ status }),
        );

        // When
        const { text, redirects } = await mount(<DashboardPage />);

        // Then: 돌아가기 버튼이 다시 이 화면을 가리키는 닫힌 고리를 만들지 않는다.
        expect(text).not.toContain(ACCESS_DENIED_HEADING);
        expect(redirects).toContain(onboardingPathFor(status));
      },
    );

    it.each(ASSIGNED_PERSONAS)(
      '%s는 상단 대시보드 입구를 그대로 받는다',
      async (_label, access) => {
        // Given
        mocks.useSession.mockReturnValue(authenticatedSession(access));

        // When
        const { text } = await mount(
          <AppFrame brand="OSS Hub" items={[]}>
            <p>본문</p>
          </AppFrame>,
        );

        // Then
        expect(text).toContain('대시보드');
      },
    );
  });

  /**
   * 승인 이력만 남고 권한은 없는 사람 — 두 화면이 서로를 가리키던 자리.
   *
   * 이 상태는 권한 회수가 `REVOKED` 기록을 남기지 못한 계정에서 생긴다. 대시보드는
   * 면이 없는 그를 승인 대기 화면으로 보내고, 승인 대기 화면은 그 승인을 아직 살아
   * 있는 것으로 읽어 그를 대시보드로 돌려보냈다. 어느 쪽도 멈추지 않으니 사용자가
   * 본 것은 양쪽의 `확인 중…`뿐이었고, 한 바퀴마다 세션 재조회가 한 번씩 더 나갔다.
   *
   * 그래서 여기서 묻는 것은 문구가 아니라 **멈추는가**다.
   */
  describe('승인 기록만 남은 무권한 교직원', () => {
    beforeEach(() => {
      mocks.useSession.mockReturnValue(
        authenticatedSession(ZERO_SURFACE_STAFF),
      );
      mocks.fetchMyStaffAccessRequest.mockResolvedValue(
        staffAccessRequest({
          status: 'APPROVED',
          decidedAt: '2026-07-30T03:00:00.000Z',
        }),
      );
    });

    it('승인 대기 화면은 사정을 설명하고 어디로도 보내지 않는다', async () => {
      // When
      const { text, redirects } = await mount(<OnboardingPendingPage />);

      // Then: 고리의 한쪽 — 이 화면에서 나가는 이동이 없다.
      expect(redirects).toEqual([]);
      expect(mocks.refresh).not.toHaveBeenCalled();
      // 멈추는 자리는 기존 대기 안내다. 요청 원장과 권한 플래그가 갈라졌다는
      // 사실은 관리자 장부의 것이라 회원 화면에 적지 않는다.
      expect(text).toContain('교직원 승인을 기다리고 있습니다');
      expect(text).toContain('상태 새로고침');
      expect(text).not.toContain('권한이 없습니다');
      expect(text).not.toContain('권한 없음');
    });

    it('대시보드에서 출발해도 한 번의 이동으로 멈춘다', async () => {
      // When: 대시보드가 보낸 곳으로 실제로 한 번 더 들어간다 — 목적지를 눈으로만
      // 확인하면 그 목적지가 출발지를 도로 가리키는 고리를 잡지 못한다(#673의 교훈).
      const departure = await mount(<DashboardPage />);
      const arrival = await mount(<OnboardingPendingPage />);

      // Then
      expect([...new Set(departure.redirects)]).toEqual([
        '/onboarding/pending',
      ]);
      expect(departure.text).not.toContain(ACCESS_DENIED_HEADING);
      expect(arrival.redirects).toEqual([]);
    });
  });

  /**
   * 승인 대기 화면에 닿는 나머지 상태 — 고치기 전과 **같은 곳에서** 멈춰야 한다.
   *
   * 바뀜 것은 `APPROVED`의 **이동**뿐이고, 그 사람이 멈춰 서는 안내는 이미 이
   * 화면에 있던 대기 안내다. `REJECTED`·`REVOKED`·`null`은 여전히 여기 머물지
   * 않는다는 것을 같이 못박는다.
   */
  describe('승인 대기 화면의 나머지 상태는 그대로다', () => {
    it('승인 대기 교직원은 대기 안내를 그 자리에서 본다', async () => {
      // Given
      mocks.useSession.mockReturnValue(
        authenticatedSession(ZERO_SURFACE_STAFF),
      );
      mocks.fetchMyStaffAccessRequest.mockResolvedValue(
        staffAccessRequest({ status: 'PENDING' }),
      );

      // When
      const { text, redirects } = await mount(<OnboardingPendingPage />);

      // Then
      expect(redirects).toEqual([]);
      expect(text).toContain('교직원 승인을 기다리고 있습니다');
    });

    it.each(['REJECTED', 'REVOKED', null] as const)(
      '%s 상태는 승인 대기 화면에 머무르지 않고 역할 선택으로 간다',
      async (status) => {
        // Given
        mocks.useSession.mockReturnValue(
          authenticatedSession(ZERO_SURFACE_STAFF),
        );
        mocks.fetchMyStaffAccessRequest.mockResolvedValue(
          status === null ? null : staffAccessRequest({ status }),
        );

        // When
        const { redirects } = await mount(<OnboardingPendingPage />);

        // Then
        expect(redirects).toContain('/onboarding/role');
      },
    );
  });

  describe('설정 예외는 살아 있는 요청에만 열린다', () => {
    it('승인 대기 교직원은 설정을 그대로 연다', async () => {
      // Given
      mocks.useSession.mockReturnValue(
        authenticatedSession(ZERO_SURFACE_STAFF),
      );
      mocks.fetchMyStaffAccessRequest.mockResolvedValue(
        staffAccessRequest({ status: 'PENDING' }),
      );

      // When
      const { text, redirects } = await mount(<SettingsPage />);

      // Then: 게이트가 열어 준 표식은 그 예외에만 붙는 안내다 — 화면이 쉽게 쓰는
      // 문장을 여기 박지 않고 그 화면이 내보낸 값을 그대로 쓴다.
      expect(redirects).toEqual([]);
      expect(text).toContain(SETTINGS_ONBOARDING_NOTICE_HEADING);
      expect(text).not.toContain(ACCESS_DENIED_HEADING);
    });

    it.each(['REJECTED', 'REVOKED'] as const)(
      '%s 교직원에게는 설정을 열지 않고 역할 선택으로 되돌린다',
      async (status) => {
        // Given
        mocks.useSession.mockReturnValue(
          authenticatedSession(ZERO_SURFACE_STAFF),
        );
        mocks.fetchMyStaffAccessRequest.mockResolvedValue(
          staffAccessRequest({ status }),
        );

        // When
        const { redirects } = await mount(<SettingsPage />);

        // Then
        expect(redirects).toContain('/onboarding/role');
      },
    );
  });
});
