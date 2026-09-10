// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { ProfileOnboardingScreen } from './components/profile-onboarding-screen';

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    replace,
    router: { replace, push: vi.fn(), refresh: vi.fn() },
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('프로필 온보딩 동의 다이얼로그', () => {
  const NEXT_PATH = '/student';
  let container: HTMLDivElement;
  let root: Root;
  let profileResponder: (method: string) => Response;

  function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function profile(): unknown {
    return {
      name: '합성 학생',
      studentId: '9'.repeat(9),
      department: '인공지능학부',
      phone: '1'.repeat(10),
      isComplete: true,
    };
  }

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

  beforeEach(() => {
    mocks.replace.mockReset();
    profileResponder = () => jsonResponse(profile());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        profileResponder(init?.method ?? 'GET'),
      ),
    );
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: vi.fn(), search: '', pathname: '/onboarding/profile' },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('동의가 필요하면 현재 프로필 주소에서 다이얼로그를 열고 완료 후 다시 판단한다', async () => {
    // Given: 첫 프로필 조회는 필수 동의 오류이고, 동의 후 조회는 완료된 프로필이다.
    let profileReads = 0;
    profileResponder = (method) => {
      if (method === 'GET') {
        profileReads += 1;
        if (profileReads === 1) throw consentRequiredError();
      }
      return jsonResponse(profile());
    };

    // When: 프로필 주소에서 필수 동의를 완료한다.
    await act(async () => {
      root.render(
        <ProfileOnboardingScreen
          memberKind="STUDENT"
          nextPath={NEXT_PATH}
          renderConsentRequired={({ open, onCompleted }) =>
            open ? (
              <button type="button" onClick={() => onCompleted()}>
                동의 다이얼로그 완료
              </button>
            ) : null
          }
        />,
      );
    });

    expect(container.textContent).toContain('동의 다이얼로그 완료');
    expect(mocks.replace).not.toHaveBeenCalledWith('/consent');

    const completion = container.querySelector('button');
    await act(async () => completion?.click());

    // Then: 동의 완료 콜백이 프로필을 다시 읽어 다음 단계로 보낸다.
    expect(mocks.replace).toHaveBeenCalledWith(NEXT_PATH);
  });

  it('동의가 필요할 때 닫기 요청만으로 스켈레톤에 남겨 두지 않는다', async () => {
    // Given: profile loading ends in a required-consent error.
    profileResponder = (method) => {
      if (method === 'GET') throw consentRequiredError();
      return jsonResponse(profile());
    };

    // When: the supplied dialog renderer asks to close before completion.
    await act(async () => {
      root.render(
        <ProfileOnboardingScreen
          memberKind="STUDENT"
          nextPath={NEXT_PATH}
          renderConsentRequired={({ open, onOpenChange }) =>
            open ? (
              <button type="button" onClick={() => onOpenChange(false)}>
                동의 다이얼로그 닫기 시도
              </button>
            ) : null
          }
        />,
      );
    });
    const dismiss = container.querySelector('button');
    await act(async () => dismiss?.click());

    // Then: the required-consent action stays visible with the loading shell.
    expect(
      container.querySelector('[aria-label="프로필을 불러오는 중"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(container.textContent).toContain('동의 다이얼로그 닫기 시도');
  });
});
