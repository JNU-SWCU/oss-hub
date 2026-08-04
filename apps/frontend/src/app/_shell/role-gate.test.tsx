// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoleRequestStatus } from '@/features/roles/types';
import type { SessionRoleState } from './use-session-role';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  useSessionRole: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.replace,
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('./use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));

import {
  RoleGate,
  roleGateDeniedHomePath,
  roleGateRedirectPath,
  shouldOpenForUnassigned,
} from './role-gate';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function state(overrides: Partial<SessionRoleState> = {}): SessionRoleState {
  return {
    status: 'loading',
    role: null,
    roleRequestStatus: null,
    selectedRole: null,
    isProfileComplete: false,
    ...overrides,
  };
}

describe('roleGateRedirectPath', () => {
  // 회귀 방지: 조회 실패를 anonymous로 접어 넣으면 로그인한 사용자가 랜딩으로
  // 밀려나고 화면상 로그아웃된 것처럼 보인다. 실패는 어디로도 보내지 않는다.
  it('세션 조회 실패는 어디로도 리다이렉트하지 않는다', () => {
    expect(
      roleGateRedirectPath({
        status: 'error',
        role: null,
        roleRequestStatus: null,
        selectedRole: null,
        isProfileComplete: true,
      }),
    ).toBeNull();
  });

  // 권한 불일치를 조용히 되돌리면 사용자는 왜 다른 화면이 떠 있는지 모른 채
  // 같은 시도를 반복한다. 이제 이동시키지 않고 안내 화면을 띄운다 — 그래서 이
  // 판단은 어떤 역할이 허용됐는지(`allow`)를 아예 보지 않는다.
  it.each(['STAFF', 'ADMIN'] as const)(
    '역할이 배정된 %s는 허용 목록과 무관하게 이동시키지 않는다',
    (role) => {
      expect(
        roleGateRedirectPath({
          status: 'assigned',
          role,
          roleRequestStatus: null,
          selectedRole: null,
          isProfileComplete: true,
        }),
      ).toBeNull();
    },
  );

  it('프로필까지 마친 학생도 이동시키지 않는다', () => {
    expect(
      roleGateRedirectPath({
        status: 'assigned',
        role: 'STUDENT',
        roleRequestStatus: null,
        selectedRole: null,
        isProfileComplete: true,
      }),
    ).toBeNull();
  });

  it('안내 화면의 돌아가기는 deniedPath를, 없으면 자기 역할 홈을 가리킨다', () => {
    expect(roleGateDeniedHomePath('STAFF', '/staff/dashboard')).toBe(
      '/staff/dashboard',
    );
    expect(roleGateDeniedHomePath('STAFF')).toBe('/staff/dashboard');
    expect(roleGateDeniedHomePath('STUDENT')).toBe('/dashboard');
    expect(roleGateDeniedHomePath('ADMIN')).toBe('/admin/access');
  });

  it('역할 미선택 사용자는 기존 온보딩 흐름을 유지한다', () => {
    expect(
      roleGateRedirectPath({
        status: 'unassigned',
        role: null,
        roleRequestStatus: null,
        selectedRole: null,
        isProfileComplete: true,
      }),
    ).toBe('/onboarding/role');
  });
});

describe('shouldOpenForUnassigned', () => {
  it('안내를 준 화면은 미배정 사용자에게 그대로 열린다', () => {
    expect(shouldOpenForUnassigned('unassigned', true)).toBe(true);
  });

  it('안내를 주지 않은 화면은 기존대로 되돌려보낸다', () => {
    expect(shouldOpenForUnassigned('unassigned', false)).toBe(false);
  });

  // 비로그인은 남의 프로필을 여는 셈이고, 조회 실패는 "역할이 없음"이 아니라
  // "역할을 모름"이라 화면을 열 근거가 못 된다. loading·assigned는 각자의 처리가
  // 따로 있다.
  it.each(['anonymous', 'loading', 'error', 'assigned'] as const)(
    '%s 상태는 안내가 있어도 열어 주지 않는다',
    (status) => {
      expect(shouldOpenForUnassigned(status, true)).toBe(false);
    },
  );
});

/**
 * 게이트가 실제로 무엇을 그리고 어디로 보내는지 본다.
 *
 * 판단 함수만 검사하면 "안내를 띄운 뒤 결국 되돌아갔다"와 "되돌아가지 않고 열어
 * 줬다"를 구분하지 못한다 — #581에서 사용자가 겪은 것이 정확히 그 차이다. 이동은
 * `useEffect`에서 일어나므로 서버 렌더가 아니라 클라이언트로 마운트한다.
 */
describe('RoleGate 렌더', () => {
  const NOTICE = '가입 안내';
  const CHILD = '설정 폼';

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.replace.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(
    overrides: Partial<SessionRoleState>,
    options: { readonly withNotice: boolean },
  ): Promise<string> {
    mocks.useSessionRole.mockReturnValue({
      ...state(overrides),
      retry: () => {},
    });
    await act(async () =>
      root.render(
        <RoleGate
          allow={['STUDENT', 'STAFF', 'ADMIN']}
          {...(options.withNotice ? { unassignedNotice: <p>{NOTICE}</p> } : {})}
        >
          <p>{CHILD}</p>
        </RoleGate>,
      ),
    );
    return container.textContent ?? '';
  }

  // 신고된 증상 그대로다: 승인을 기다리는 교직원이 설정에 들어가면 안내만 스치고
  // 승인 대기 화면으로 되돌아갔다. 이제는 되돌아가지 않고 폼까지 닿는다.
  it('안내를 준 화면은 승인 대기 교직원을 되돌리지 않고 자식까지 그린다', async () => {
    const text = await render(
      { status: 'unassigned', roleRequestStatus: 'PENDING' },
      { withNotice: true },
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(text).toContain(NOTICE);
    expect(text).toContain(CHILD);
  });

  it('안내가 있어도 비로그인은 랜딩으로 보내고 아무것도 열지 않는다', async () => {
    const text = await render({ status: 'anonymous' }, { withNotice: true });

    expect(mocks.replace).toHaveBeenCalledWith('/');
    expect(text).not.toContain(CHILD);
    expect(text).not.toContain(NOTICE);
  });

  it('안내가 있어도 조회 실패는 어디로도 보내지 않고 재시도를 준다', async () => {
    const text = await render({ status: 'error' }, { withNotice: true });

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(text).not.toContain(CHILD);
    expect(text).not.toContain(NOTICE);
    expect(text).toContain('다시 시도');
  });

  /**
   * `RoleGate`는 모든 역할 화면이 함께 쓴다. 안내를 넘기지 않는 화면의 미배정
   * 처리가 한 갈래라도 달라지면 업무 화면이 가입 중인 사용자에게 열린다.
   */
  it.each([
    [null, '/onboarding/role'],
    ['REVOKED', '/onboarding/role'],
    ['PENDING', '/onboarding/pending'],
    ['APPROVED', '/onboarding/pending'],
    ['REJECTED', '/onboarding/pending'],
  ] as readonly (readonly [RoleRequestStatus | null, string])[])(
    '안내를 주지 않은 화면은 %s 미배정 사용자를 %s 로 종전대로 되돌린다',
    async (roleRequestStatus, path) => {
      const text = await render(
        { status: 'unassigned', roleRequestStatus },
        { withNotice: false },
      );

      expect(mocks.replace).toHaveBeenCalledWith(path);
      expect(text).not.toContain(CHILD);
    },
  );

  it('역할이 배정되고 프로필까지 마친 사용자는 안내 없이 자기 화면을 본다', async () => {
    const text = await render(
      { status: 'assigned', role: 'STAFF', isProfileComplete: true },
      { withNotice: true },
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(text).toContain(CHILD);
    expect(text).not.toContain(NOTICE);
  });

  it('역할은 있지만 프로필이 비어 있으면 안내와 무관하게 프로필 단계로 되돌린다', async () => {
    const text = await render(
      { status: 'assigned', role: 'STAFF', isProfileComplete: false },
      { withNotice: true },
    );

    expect(mocks.replace).toHaveBeenCalledWith('/onboarding/profile');
    expect(text).not.toContain(CHILD);
  });
});
