// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
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

import { RoleGate, type UnassignedAccessPolicy } from './role-gate';
import { useSharedSessionRole } from './session-role-context';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/**
 * 게이트가 실제로 무엇을 그리고 어디로 보내는지 본다.
 *
 * 판단 함수만 검사하면(`role-gate-policy.test.ts`) "안내를 띄운 뒤 결국 되돌아갔다"와
 * "되돌아가지 않고 열어 줬다"를 구분하지 못한다 — #581에서 사용자가 겪은 것이 정확히
 * 그 차이다. 이동은 `useEffect`에서 일어나므로 서버 렌더가 아니라 클라이언트로
 * 마운트한다. 화면별 규칙은 여기서 검사하지 않는다(설정 규칙은 `settings/`가 갖는다)
 * — 이 파일이 보는 것은 "규칙을 어떻게 대접하는가"다.
 */
describe('RoleGate 렌더', () => {
  const NOTICE = '가입 안내';
  const CHILD = '설정 폼';
  const OPEN: UnassignedAccessPolicy = () => true;

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.useSessionRole.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function state(overrides: Partial<SessionRoleState>): SessionRoleState {
    return {
      status: 'loading',
      role: null,
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
      roleRequestStatus: null,
      roleRequestRejectionReason: null,
      selectedRole: null,
      isProfileComplete: false,
      ...overrides,
    };
  }

  async function render(
    overrides: Partial<SessionRoleState>,
    gate: {
      readonly unassignedAccess?: UnassignedAccessPolicy;
      readonly unassignedNotice?: ReactNode;
    } = {},
  ): Promise<string> {
    mocks.useSessionRole.mockReturnValue({
      ...state(overrides),
      retry: () => {},
    });
    await act(async () =>
      root.render(
        <RoleGate allow={['student', 'staff', 'admin']} {...gate}>
          <p>{CHILD}</p>
        </RoleGate>,
      ),
    );
    return container.textContent ?? '';
  }

  // 신고된 증상 그대로다: 승인을 기다리는 교직원이 설정에 들어가면 안내만 스치고
  // 승인 대기 화면으로 되돌아갔다. 이제는 되돌아가지 않고 폼까지 닿는다.
  it('규칙이 인정한 미배정 사용자는 되돌리지 않고 안내와 자식을 함께 그린다', async () => {
    const text = await render(
      { status: 'unassigned', roleRequestStatus: 'PENDING' },
      { unassignedAccess: OPEN, unassignedNotice: <p>{NOTICE}</p> },
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(text).toContain(NOTICE);
    expect(text).toContain(CHILD);
  });

  it('규칙이 거절한 미배정 사용자는 안내를 준 화면에서도 되돌린다', async () => {
    const text = await render(
      { status: 'unassigned', roleRequestStatus: 'REJECTED' },
      { unassignedAccess: () => false, unassignedNotice: <p>{NOTICE}</p> },
    );

    // 반려는 역할 선택으로 되돌린다(#535).
    expect(mocks.replace).toHaveBeenCalledWith('/onboarding/role');
    expect(text).not.toContain(CHILD);
    expect(text).not.toContain(NOTICE);
  });

  /**
   * 회귀 방지 — 이 PR 직전의 결함이다.
   *
   * 권한을 `unassignedNotice !== undefined`로 정하던 때에는, 아무것도 그리지 않는
   * ReactNode(`null`·`false`)를 넘겨도 자식이 열렸다. 화면에는 안내조차 없는데 권한만
   * 열리는 fail-open이라, 안내를 조건부로 만들다 실수하면 그대로 뚫린다. 이제 안내는
   * 권한에 관여하지 않는다.
   */
  it.each([
    ['null', null],
    ['false', false],
    ['빈 문자열', ''],
  ] as readonly (readonly [string, ReactNode])[])(
    '아무것도 그리지 않는 %s 안내는 규칙 없이 권한을 열지 않는다',
    async (_label, notice) => {
      const text = await render(
        { status: 'unassigned', roleRequestStatus: 'PENDING' },
        { unassignedNotice: notice },
      );

      expect(mocks.replace).toHaveBeenCalledWith('/onboarding/pending');
      expect(text).not.toContain(CHILD);
    },
  );

  it('규칙이 있으면 안내가 없어도 화면은 열린다 — 안내는 표시일 뿐이다', async () => {
    const text = await render(
      { status: 'unassigned', roleRequestStatus: 'PENDING' },
      { unassignedAccess: OPEN },
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(text).toContain(CHILD);
  });

  it('비로그인은 리다이렉트하지 않고 로그인 안내를 그 자리에 보여준다(QA46)', async () => {
    const text = await render(
      { status: 'anonymous' },
      { unassignedAccess: OPEN, unassignedNotice: <p>{NOTICE}</p> },
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(text).not.toContain(CHILD);
    expect(text).not.toContain(NOTICE);
    expect(text).toContain('로그인이 필요한 페이지입니다');
  });

  it('안내가 있어도 조회 실패는 어디로도 보내지 않고 재시도를 준다', async () => {
    const text = await render(
      { status: 'error' },
      { unassignedAccess: OPEN, unassignedNotice: <p>{NOTICE}</p> },
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(text).not.toContain(CHILD);
    expect(text).not.toContain(NOTICE);
    expect(text).toContain('다시 시도');
  });

  /**
   * `RoleGate`는 모든 역할 화면이 함께 쓴다. 규칙을 넘기지 않는 화면의 미배정
   * 처리가 한 갈래라도 달라지면 업무 화면이 가입 중인 사용자에게 열린다.
   */
  it.each([
    [null, '/onboarding/role'],
    ['REVOKED', '/onboarding/role'],
    ['PENDING', '/onboarding/pending'],
    ['APPROVED', '/onboarding/pending'],
    // 반려는 살아 있는 신청이 없어 역할부터 다시 고른다(#535).
    ['REJECTED', '/onboarding/role'],
  ] as readonly (readonly [RoleRequestStatus | null, string])[])(
    '규칙을 주지 않은 화면은 %s 미배정 사용자를 %s 로 종전대로 되돌린다',
    async (roleRequestStatus, path) => {
      const text = await render({ status: 'unassigned', roleRequestStatus });

      expect(mocks.replace).toHaveBeenCalledWith(path);
      expect(text).not.toContain(CHILD);
    },
  );

  it('역할이 배정되고 프로필까지 마친 사용자는 안내 없이 자기 화면을 본다', async () => {
    const text = await render(
      {
        status: 'assigned',
        role: 'STAFF',
        memberKind: 'STAFF',
        hasStaffAccess: true,
        isProfileComplete: true,
      },
      { unassignedAccess: OPEN, unassignedNotice: <p>{NOTICE}</p> },
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(text).toContain(CHILD);
    expect(text).not.toContain(NOTICE);
  });

  it('역할은 있지만 프로필이 비어 있으면 규칙과 무관하게 프로필 단계로 되돌린다', async () => {
    const text = await render(
      { status: 'assigned', role: 'STAFF', isProfileComplete: false },
      { unassignedAccess: OPEN, unassignedNotice: <p>{NOTICE}</p> },
    );

    expect(mocks.replace).toHaveBeenCalledWith('/onboarding/profile');
    expect(text).not.toContain(CHILD);
  });

  /**
   * 게이트가 판단에 쓴 스냅샷을 자식이 그대로 물려받는지. 자식이 훅을 다시 부르면
   * 역할 요청 조회가 두 번 나가고, 게이트가 연 근거와 화면이 폼을 그리는 근거가
   * 서로 다른 순간의 답이 될 수 있다.
   */
  it('판단에 쓴 세션 스냅샷을 자식에게 그대로 물려준다', async () => {
    const snapshot = {
      ...state({
        status: 'unassigned',
        roleRequestStatus: 'PENDING',
        selectedRole: 'STAFF',
      }),
      retry: () => {},
    };
    mocks.useSessionRole.mockReturnValue(snapshot);
    let received: unknown = null;

    function Probe() {
      received = useSharedSessionRole();
      return null;
    }

    await act(async () =>
      root.render(
        <RoleGate allow={['student']} unassignedAccess={OPEN}>
          <Probe />
        </RoleGate>,
      ),
    );

    expect(received).toBe(snapshot);
    expect(mocks.useSessionRole).toHaveBeenCalledTimes(1);
  });
});
