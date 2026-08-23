// @vitest-environment happy-dom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const router = {
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
  };

  return {
    router,
    fetchMyStaffAccessRequest: vi.fn(),
    fetchMyRoleSelection: vi.fn(),
    getMyProfile: vi.fn(),
    useSession: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/onboarding/pending',
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/features/auth/use-session', () => ({
  useSession: mocks.useSession,
}));

vi.mock('@/features/profile/api', () => ({
  classifyProfileApiError: vi.fn(() => 'generic'),
  getMyProfile: mocks.getMyProfile,
}));

vi.mock('@/features/roles/api', () => ({
  fetchMyStaffAccessRequest: mocks.fetchMyStaffAccessRequest,
  fetchMyRoleSelection: mocks.fetchMyRoleSelection,
  requestStaffRole: vi.fn(),
  selectRole: vi.fn(),
}));

import { AppFrame } from '../../_shell/app-frame';
import { useSharedSessionRole } from '../../_shell/session-role-context';
import OnboardingPendingPage from './page';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function SharedRoleRefreshProbe() {
  const { staffAccessRequestStatus, retry } = useSharedSessionRole();
  return (
    <button type="button" onClick={retry}>
      {staffAccessRequestStatus ?? 'NONE'}
    </button>
  );
}

describe('승인 대기 화면 역할 요청 조회', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({
      status: 'authenticated',
      user: {
        nickname: 'pending-staff',
        name: '승인 대기 교직원',
        email: null,
        avatarUrl: null,
        memberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: false,
        isProfileComplete: true,
      },
      retry: vi.fn(),
    });
    mocks.fetchMyStaffAccessRequest.mockResolvedValue({
      requestedRole: 'STAFF',
      status: 'PENDING',
      requestedAt: '2026-08-08T00:00:00.000Z',
      decidedAt: null,
      rejectionReason: null,
    });
    mocks.fetchMyRoleSelection.mockResolvedValue({ selectedRole: 'STAFF' });
    mocks.getMyProfile.mockResolvedValue({ isComplete: true });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('공통 셸·게이트·본문이 같은 최초 조회 결과를 한 번만 쓴다', async () => {
    await act(async () => {
      root.render(
        <AppFrame>
          <OnboardingPendingPage />
        </AppFrame>,
      );
    });

    expect(container.textContent).toContain('교직원 승인을 기다리고 있습니다');
    expect(mocks.fetchMyStaffAccessRequest).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMyRoleSelection).toHaveBeenCalledTimes(1);
  });

  it('상태 새로고침은 세션 전환 뒤 공통 역할 스냅샷을 실제로 다시 읽는다', async () => {
    mocks.useSession.mockImplementation(() => {
      const [status, setStatus] = useState<'authenticated' | 'loading'>(
        'authenticated',
      );
      const retry = () => {
        setStatus('loading');
        queueMicrotask(() => setStatus('authenticated'));
      };
      return status === 'loading'
        ? { status, user: null, retry }
        : {
            status,
            user: {
              nickname: 'pending-staff',
              name: '승인 대기 교직원',
              email: null,
              avatarUrl: null,
              memberKind: null,
              hasStaffAccess: false,
              hasAdminAccess: false,
              isProfileComplete: true,
            },
            retry,
          };
    });
    mocks.fetchMyStaffAccessRequest
      .mockResolvedValueOnce({
        requestedRole: 'STAFF',
        status: 'PENDING',
        requestedAt: '2026-08-08T00:00:00.000Z',
        decidedAt: null,
        rejectionReason: null,
      })
      .mockResolvedValueOnce({
        requestedRole: 'STAFF',
        status: 'REJECTED',
        requestedAt: '2026-08-08T00:00:00.000Z',
        decidedAt: '2026-08-08T01:00:00.000Z',
        rejectionReason: '소속 정보를 다시 확인해 주세요.',
      });

    await act(async () => {
      root.render(
        <AppFrame>
          <SharedRoleRefreshProbe />
        </AppFrame>,
      );
    });
    expect(container.textContent).toContain('PENDING');

    const refresh = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'PENDING',
    );
    if (!(refresh instanceof HTMLButtonElement)) {
      throw new TypeError('상태 새로고침 버튼을 찾지 못했습니다.');
    }
    await act(async () => refresh.click());
    await vi.waitFor(() => {
      expect(container.textContent).toContain('REJECTED');
    });

    expect(mocks.fetchMyStaffAccessRequest).toHaveBeenCalledTimes(2);
    expect(mocks.fetchMyRoleSelection).toHaveBeenCalledTimes(2);
  });
});
