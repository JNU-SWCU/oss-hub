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
    const actual = await importOriginal<
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
