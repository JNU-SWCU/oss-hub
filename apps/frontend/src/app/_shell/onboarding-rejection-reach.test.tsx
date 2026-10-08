import { Component, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StaffAccessRequest,
  StaffAccessRequestStatus,
} from '@/features/roles/types';
import { onboardingPathFor, type ProfileCheckStatus } from './onboarding-route';

const REJECTION_REASON = '합성 반려 사유 — 소속 학과가 확인되지 않았습니다.';
const REJECTION_HEADLINE = '교직원 요청이 반려되었습니다';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
  fetchMyStaffAccessRequest: vi.fn(),
  fetchMyRoleSelection: vi.fn(),
  selectRole: vi.fn(),
  requestStaffRole: vi.fn(),
  getMyProfile: vi.fn(),
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
  fetchMyStaffAccessRequest: mocks.fetchMyStaffAccessRequest,
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

const AUTHENTICATED_SESSION = {
  status: 'authenticated' as const,
  user: {
    nickname: 'synthetic-staff-applicant',
    name: '합성 교직원 사용자',
    email: null,
    avatarUrl: null,
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: true,
  },
  retry: () => {},
};

const PROFILE_CHECK_STATUS: ProfileCheckStatus = 'complete';

const COMPLETE_PROFILE = {
  name: '합성 교직원 사용자',
  studentId: null,
  department: '인공지능학부',
  isComplete: true,
};

const ONBOARDING_SCREENS = [
  ['/onboarding/pending', OnboardingPendingPage],
  ['/onboarding/profile', OnboardingProfilePage],
  ['/onboarding/role', OnboardingRolePage],
] as const satisfies readonly (readonly [string, () => ReactNode])[];

function rejectedDestination(): string {
  const path = onboardingPathFor('REJECTED', PROFILE_CHECK_STATUS);
  if (path === null) {
    throw new Error(
      '라우팅 계약이 반려 사용자의 목적지를 확정하지 못했다 — 이 검사의 전제가 깨졌다.',
    );
  }
  return path;
}

function staffAccessRequest(
  overrides: Partial<StaffAccessRequest> = {},
): StaffAccessRequest {
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

    mocks.useSession.mockReturnValue(AUTHENTICATED_SESSION);
    mocks.fetchMyRoleSelection.mockResolvedValue({ selectedRole: null });
    mocks.getMyProfile.mockResolvedValue(COMPLETE_PROFILE);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container, {
      onCaughtError: () => {},
      onUncaughtError: () => {},
    });
  });

  afterEach(async () => {
    await act(() => {
      root.unmount();
      return Promise.resolve();
    });
    container.remove();
  });

  interface MountedScreen {
    readonly text: string;

    readonly redirects: readonly string[];

    readonly staffAccessRequestFetches: number;
  }

  async function mountEveryOnboardingScreen(): Promise<
    ReadonlyMap<string, MountedScreen>
  > {
    const rendered = new Map<string, MountedScreen>();
    for (const [path, Screen] of ONBOARDING_SCREENS) {
      mocks.replace.mockClear();
      mocks.redirect.mockClear();
      mocks.fetchMyStaffAccessRequest.mockClear();
      await act(() => {
        root.render(
          <RedirectBoundary>
            <Screen />
          </RedirectBoundary>,
        );
        return Promise.resolve();
      });
      rendered.set(path, {
        text: container.textContent ?? '',
        redirects: [
          ...mocks.replace.mock.calls.map(([target]) => String(target)),
          ...mocks.redirect.mock.calls.map(([target]) => String(target)),
        ],
        staffAccessRequestFetches:
          mocks.fetchMyStaffAccessRequest.mock.calls.length,
      });
      await act(() => {
        root.render(<></>);
        return Promise.resolve();
      });
    }
    return rendered;
  }

  it('게이트가 보내는 목적지에서 반려 사유를 읽는다', async () => {
    mocks.fetchMyStaffAccessRequest.mockResolvedValue(
      staffAccessRequest({
        status: 'REJECTED',
        decidedAt: '2026-07-31T05:00:00.000Z',
        rejectionReason: REJECTION_REASON,
      }),
    );

    const rendered = await mountEveryOnboardingScreen();

    const arrived = rendered.get(rejectedDestination());

    expect(arrived).toBeDefined();

    expect(arrived?.redirects).toEqual([]);

    expect(arrived?.text).toContain(REJECTION_REASON);

    expect(arrived?.staffAccessRequestFetches).toBe(1);
  });

  it('사유가 비어 있어도 반려됐다는 사실은 도달한다', async () => {
    mocks.fetchMyStaffAccessRequest.mockResolvedValue(
      staffAccessRequest({
        status: 'REJECTED',
        decidedAt: '2026-07-31T05:00:00.000Z',
        rejectionReason: null,
      }),
    );

    const rendered = await mountEveryOnboardingScreen();

    const arrived = rendered.get(rejectedDestination());
    expect(arrived?.redirects).toEqual([]);
    expect(arrived?.text).toContain(REJECTION_HEADLINE);

    expect(arrived?.text).not.toContain('반려 사유');
  });

  it.each([
    ['요청 없음', null],
    ['승인 대기', 'PENDING'],
    ['회수', 'REVOKED'],
  ] as readonly (readonly [string, StaffAccessRequestStatus | null])[])(
    '%s 사용자에게는 반려 안내가 어느 화면에도 없다',
    async (_label, status) => {
      mocks.fetchMyStaffAccessRequest.mockResolvedValue(
        status === null ? null : staffAccessRequest({ status }),
      );

      const rendered = await mountEveryOnboardingScreen();

      for (const { text } of rendered.values()) {
        expect(text).not.toContain(REJECTION_HEADLINE);
        expect(text).not.toContain(REJECTION_REASON);
      }
    },
  );

  it('재요청이 접수돼 승인 대기가 되면 반려 안내가 사라진다', async () => {
    mocks.fetchMyStaffAccessRequest.mockResolvedValue(
      staffAccessRequest({ status: 'PENDING' }),
    );

    const rendered = await mountEveryOnboardingScreen();

    for (const { text } of rendered.values()) {
      expect(text).not.toContain(REJECTION_HEADLINE);
    }
  });
});
