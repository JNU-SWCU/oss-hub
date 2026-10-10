import { Component, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      mocks.useSession.mockReturnValue(
        authenticatedSession(ZERO_SURFACE_STAFF),
      );
      mocks.fetchMyStaffAccessRequest.mockResolvedValue(
        staffAccessRequest({ status: 'PENDING' }),
      );

      const { text } = await mount(
        <AppFrame brand="OSS Hub" items={[]}>
          <p>본문</p>
        </AppFrame>,
      );

      expect(text).not.toContain('대시보드');
    });

    it.each(['PENDING', 'REJECTED', 'REVOKED'] as const)(
      '%s 교직원이 /dashboard에 닿으면 안내가 아니라 온보딩으로 보낸다',
      async (status) => {
        mocks.useSession.mockReturnValue(
          authenticatedSession(ZERO_SURFACE_STAFF),
        );
        mocks.fetchMyStaffAccessRequest.mockResolvedValue(
          staffAccessRequest({ status }),
        );

        const { text, redirects } = await mount(<DashboardPage />);

        expect(text).not.toContain(ACCESS_DENIED_HEADING);
        expect(redirects).toContain(onboardingPathFor(status));
      },
    );

    it.each(ASSIGNED_PERSONAS)(
      '%s는 상단 대시보드 입구를 그대로 받는다',
      async (_label, access) => {
        mocks.useSession.mockReturnValue(authenticatedSession(access));

        const { text } = await mount(
          <AppFrame brand="OSS Hub" items={[]}>
            <p>본문</p>
          </AppFrame>,
        );

        expect(text).toContain('대시보드');
      },
    );
  });

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
      const { text, redirects } = await mount(<OnboardingPendingPage />);

      expect(redirects).toEqual([]);
      expect(mocks.refresh).not.toHaveBeenCalled();

      expect(text).toContain('교직원 승인을 기다리고 있습니다');
      expect(text).toContain('상태 새로고침');
      expect(text).not.toContain('권한이 없습니다');
      expect(text).not.toContain('권한 없음');
    });

    it('대시보드에서 출발해도 한 번의 이동으로 멈춘다', async () => {
      const departure = await mount(<DashboardPage />);
      const arrival = await mount(<OnboardingPendingPage />);

      expect([...new Set(departure.redirects)]).toEqual([
        '/onboarding/pending',
      ]);
      expect(departure.text).not.toContain(ACCESS_DENIED_HEADING);
      expect(arrival.redirects).toEqual([]);
    });
  });

  describe('승인 대기 화면의 나머지 상태는 그대로다', () => {
    it('승인 대기 교직원은 대기 안내를 그 자리에서 본다', async () => {
      mocks.useSession.mockReturnValue(
        authenticatedSession(ZERO_SURFACE_STAFF),
      );
      mocks.fetchMyStaffAccessRequest.mockResolvedValue(
        staffAccessRequest({ status: 'PENDING' }),
      );

      const { text, redirects } = await mount(<OnboardingPendingPage />);

      expect(redirects).toEqual([]);
      expect(text).toContain('교직원 승인을 기다리고 있습니다');
    });

    it.each(['REJECTED', 'REVOKED', null] as const)(
      '%s 상태는 승인 대기 화면에 머무르지 않고 역할 선택으로 간다',
      async (status) => {
        mocks.useSession.mockReturnValue(
          authenticatedSession(ZERO_SURFACE_STAFF),
        );
        mocks.fetchMyStaffAccessRequest.mockResolvedValue(
          status === null ? null : staffAccessRequest({ status }),
        );

        const { redirects } = await mount(<OnboardingPendingPage />);

        expect(redirects).toContain('/onboarding/role');
      },
    );
  });

  describe('설정 예외는 살아 있는 요청에만 열린다', () => {
    it('승인 대기 교직원은 설정을 그대로 연다', async () => {
      mocks.useSession.mockReturnValue(
        authenticatedSession(ZERO_SURFACE_STAFF),
      );
      mocks.fetchMyStaffAccessRequest.mockResolvedValue(
        staffAccessRequest({ status: 'PENDING' }),
      );

      const { text, redirects } = await mount(<SettingsPage />);

      expect(redirects).toEqual([]);
      expect(text).toContain(SETTINGS_ONBOARDING_NOTICE_HEADING);
      expect(text).not.toContain(ACCESS_DENIED_HEADING);
    });

    it.each(['REJECTED', 'REVOKED'] as const)(
      '%s 교직원에게는 설정을 열지 않고 역할 선택으로 되돌린다',
      async (status) => {
        mocks.useSession.mockReturnValue(
          authenticatedSession(ZERO_SURFACE_STAFF),
        );
        mocks.fetchMyStaffAccessRequest.mockResolvedValue(
          staffAccessRequest({ status }),
        );

        const { redirects } = await mount(<SettingsPage />);

        expect(redirects).toContain('/onboarding/role');
      },
    );
  });
});
