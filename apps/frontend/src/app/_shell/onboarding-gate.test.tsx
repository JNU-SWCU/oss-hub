import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    getMyProfile: vi.fn(),
    getCurrentConsent: vi.fn(),
    pathname: vi.fn(),
    replace,
    router: { replace },
    useSessionRole: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  usePathname: mocks.pathname,
}));

vi.mock('./shell-nav', () => ({ ShellNav: () => null }));
vi.mock('./bottom-tab-bar', () => ({ BottomTabBar: () => null }));
vi.mock('./product-shell', () => ({
  ShellMenuProvider: ({ children }: { readonly children: ReactNode }) => children,
  ProductShell: ({ children }: { readonly children: ReactNode }) => children,
}));

vi.mock('@/features/consents/api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/consents/api')>();
  return { ...actual, getCurrentConsent: mocks.getCurrentConsent };
});

vi.mock('@/features/profile/api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/profile/api')>();
  return { ...actual, getMyProfile: mocks.getMyProfile };
});

vi.mock('@/features/consents/components/consent-required-dialog', () => ({
  ConsentRequiredDialog: ({
    open,
    onOpenChange,
    onCompleted,
  }: {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly onCompleted: () => void;
  }) =>
    open ? (
      <>
        <button type="button" onClick={() => onOpenChange(false)}>
          동의 다이얼로그 닫기 시도
        </button>
        <button type="button" onClick={onCompleted}>
          동의 다이얼로그 완료
        </button>
      </>
    ) : null,
}));

vi.mock('./use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));

import { OnboardingGate } from './onboarding-gate';
import { AppFrame } from './app-frame';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function consentRequiredError(): ApiError {
  return new ApiError({
    type: 'about:blank',
    status: 422,
    code: 'CON_003',
    title: '동의 필요',
    detail: '필수 동의가 필요합니다.',
    instance: '/users/me/profile',
  });
}

describe('OnboardingGate consent-required dialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname.mockReturnValue('/dashboard');
    mocks.getCurrentConsent.mockResolvedValue({ consented: true });
    mocks.useSessionRole.mockReturnValue({
      status: 'unassigned',
      staffAccessRequestStatus: null,
      retry: vi.fn(),
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  it(
    'assigned student without current consent sees the dialog once, then remains consented after remount',
    async () => {
      mocks.useSessionRole.mockReturnValue({
        status: 'assigned',
        memberKind: 'STUDENT',
        isProfileComplete: true,
        retry: vi.fn(),
      });
      mocks.getCurrentConsent.mockResolvedValue({ consented: false });
      const home = (
        <AppFrame>
          <p data-testid="home">학생 홈</p>
        </AppFrame>
      );

      await act(async () => root.render(home));

      expect(container.querySelector('[data-testid="home"]')).toBeNull();
      const completion = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === '동의 다이얼로그 완료',
      );
      expect(completion).toBeDefined();
      mocks.getCurrentConsent.mockResolvedValue({ consented: true });

      await act(async () => completion?.click());
      expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
      expect(container.querySelector('button')).toBeNull();
      await act(async () => root.render(null));
      await act(async () => root.render(home));
      expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
      expect(container.querySelector('button')).toBeNull();
    },
  );

  it('new signup consents during onboarding and reaches home without another popup', async () => {
    mocks.pathname.mockReturnValue('/onboarding/role');
    mocks.getMyProfile
      .mockRejectedValueOnce(consentRequiredError())
      .mockResolvedValueOnce({ isComplete: false });

    await act(async () =>
      root.render(
        <AppFrame>
          <OnboardingGate target="role">
            <p data-testid="role-selection">역할 선택 화면</p>
          </OnboardingGate>
        </AppFrame>,
      ),
    );
    const completion = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '동의 다이얼로그 완료',
    );
    expect(completion).toBeDefined();
    await act(async () => completion?.click());
    expect(container.querySelector('[data-testid="role-selection"]')).not.toBeNull();
    expect(mocks.getCurrentConsent).not.toHaveBeenCalled();

    mocks.useSessionRole.mockReturnValue({
      status: 'assigned',
      memberKind: 'STUDENT',
      isProfileComplete: true,
      retry: vi.fn(),
    });
    mocks.pathname.mockReturnValue('/dashboard');
    mocks.getCurrentConsent.mockResolvedValue({
      policyVersion: '2026-11-01',
      consented: true,
    });
    await act(async () =>
      root.render(
        <AppFrame>
          <p data-testid="home">학생 홈</p>
        </AppFrame>,
      ),
    );
    expect(mocks.getCurrentConsent).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('retries a failed consent check without bypassing consent', async () => {
    mocks.useSessionRole.mockReturnValue({
      status: 'assigned',
      memberKind: 'STUDENT',
      isProfileComplete: true,
      retry: vi.fn(),
    });
    mocks.getCurrentConsent
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ consented: false });

    await act(async () =>
      root.render(
        <AppFrame>
          <p data-testid="home">학생 홈</p>
        </AppFrame>,
      ),
    );

    expect(container.querySelector('[data-testid="home"]')).toBeNull();
    const retry = container.querySelector('button');
    expect(retry).not.toBeNull();
    await act(async () => retry?.click());
    expect(container.textContent).toContain('동의 다이얼로그 완료');
    expect(container.querySelector('[data-testid="home"]')).toBeNull();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps the current onboarding URL and resumes the gate when consent is completed', async () => {
    mocks.getMyProfile
      .mockRejectedValueOnce(consentRequiredError())
      .mockResolvedValueOnce({
        name: '합성 사용자',
        studentId: null,
        department: null,
        phone: null,
        isComplete: false,
      });

    await act(async () => {
      root.render(
        <OnboardingGate target="role">
          <p>역할 선택 화면</p>
        </OnboardingGate>,
      );
    });

    expect(container.textContent).toContain('동의 다이얼로그 완료');
    expect(mocks.replace).not.toHaveBeenCalledWith('/consent');

    const completion = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '동의 다이얼로그 완료',
    );
    await act(async () => completion?.click());

    expect(mocks.getMyProfile).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('역할 선택 화면');
  });

  it('ignores required-consent dismiss requests while profile status is checking', async () => {
    mocks.getMyProfile.mockRejectedValueOnce(consentRequiredError());

    await act(async () => {
      root.render(
        <OnboardingGate target="role">
          <p>역할 선택 화면</p>
        </OnboardingGate>,
      );
    });
    const dismiss = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '동의 다이얼로그 닫기 시도',
    );
    await act(async () => dismiss?.click());

    expect(container.textContent).toContain('동의 다이얼로그 닫기 시도');
    expect(container.textContent).toContain('확인 중…');
    expect(mocks.replace).not.toHaveBeenCalledWith('/consent');
  });
});
