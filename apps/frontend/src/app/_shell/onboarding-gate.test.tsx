import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    getMyProfile: vi.fn(),
    replace,
    router: { replace },
    useSessionRole: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}));

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
    mocks.useSessionRole.mockReturnValue({
      status: 'unassigned',
      staffAccessRequestStatus: null,
      retry: vi.fn(),
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => {
      root.unmount();
      return Promise.resolve();
    });
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

    await act(() => {
      root.render(
        <OnboardingGate target="role">
          <p>역할 선택 화면</p>
        </OnboardingGate>,
      );
      return Promise.resolve();
    });

    expect(container.textContent).toContain('동의 다이얼로그 완료');
    expect(mocks.replace).not.toHaveBeenCalledWith('/consent');

    const completion = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '동의 다이얼로그 완료',
    );
    await act(() => {
      completion?.click();
      return Promise.resolve();
    });

    expect(mocks.getMyProfile).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('역할 선택 화면');
  });

  it('ignores required-consent dismiss requests while profile status is checking', async () => {
    mocks.getMyProfile.mockRejectedValueOnce(consentRequiredError());

    await act(() => {
      root.render(
        <OnboardingGate target="role">
          <p>역할 선택 화면</p>
        </OnboardingGate>,
      );
      return Promise.resolve();
    });
    const dismiss = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '동의 다이얼로그 닫기 시도',
    );
    await act(() => {
      dismiss?.click();
      return Promise.resolve();
    });

    expect(container.textContent).toContain('동의 다이얼로그 닫기 시도');
    expect(container.textContent).toContain('확인 중…');
    expect(mocks.replace).not.toHaveBeenCalledWith('/consent');
  });
});
