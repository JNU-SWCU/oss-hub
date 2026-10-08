import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StaffAccessRequestStatus } from '@/features/roles/types';
import type { SessionRoleState } from './use-session-role';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  useSessionRole: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/programs/42/apply',
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
    await act(() => {
      root.unmount();
      return Promise.resolve();
    });
    container.remove();
  });

  function state(overrides: Partial<SessionRoleState>): SessionRoleState {
    return {
      status: 'loading',
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
      staffAccessRequestStatus: null,
      staffAccessRequestRejectionReason: null,
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
    await act(() => {
      root.render(
        <RoleGate allow={['student', 'staff', 'admin']} {...gate}>
          <p>{CHILD}</p>
        </RoleGate>,
      );
      return Promise.resolve();
    });
    return container.textContent ?? '';
  }

  it('규칙이 인정한 미배정 사용자는 되돌리지 않고 안내와 자식을 함께 그린다', async () => {
    const text = await render(
      { status: 'unassigned', staffAccessRequestStatus: 'PENDING' },
      { unassignedAccess: OPEN, unassignedNotice: <p>{NOTICE}</p> },
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(text).toContain(NOTICE);
    expect(text).toContain(CHILD);
  });

  it('규칙이 거절한 미배정 사용자는 안내를 준 화면에서도 되돌린다', async () => {
    const text = await render(
      { status: 'unassigned', staffAccessRequestStatus: 'REJECTED' },
      { unassignedAccess: () => false, unassignedNotice: <p>{NOTICE}</p> },
    );

    expect(mocks.replace).toHaveBeenCalledWith('/onboarding/role');
    expect(text).not.toContain(CHILD);
    expect(text).not.toContain(NOTICE);
  });

  it.each([
    ['null', null],
    ['false', false],
    ['빈 문자열', ''],
  ] as readonly (readonly [string, ReactNode])[])(
    '아무것도 그리지 않는 %s 안내는 규칙 없이 권한을 열지 않는다',
    async (_label, notice) => {
      const text = await render(
        { status: 'unassigned', staffAccessRequestStatus: 'PENDING' },
        { unassignedNotice: notice },
      );

      expect(mocks.replace).toHaveBeenCalledWith('/onboarding/pending');
      expect(text).not.toContain(CHILD);
    },
  );

  it('규칙이 있으면 안내가 없어도 화면은 열린다 — 안내는 표시일 뿐이다', async () => {
    const text = await render(
      { status: 'unassigned', staffAccessRequestStatus: 'PENDING' },
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
    expect(text).toContain('로그인이 필요합니다');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/signup?returnTo=%2Fprograms%2F42%2Fapply',
    );
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

  it.each([
    [null, '/onboarding/role'],
    ['REVOKED', '/onboarding/role'],
    ['PENDING', '/onboarding/pending'],
    ['APPROVED', '/onboarding/pending'],

    ['REJECTED', '/onboarding/role'],
  ] as readonly (readonly [StaffAccessRequestStatus | null, string])[])(
    '규칙을 주지 않은 화면은 %s 미배정 사용자를 %s 로 종전대로 되돌린다',
    async (staffAccessRequestStatus, path) => {
      const text = await render({
        status: 'unassigned',
        staffAccessRequestStatus,
      });

      expect(mocks.replace).toHaveBeenCalledWith(path);
      expect(text).not.toContain(CHILD);
    },
  );

  it('역할이 배정되고 프로필까지 마친 사용자는 안내 없이 자기 화면을 본다', async () => {
    const text = await render(
      {
        status: 'assigned',
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
      {
        status: 'assigned',
        memberKind: 'STAFF',
        hasStaffAccess: true,
        isProfileComplete: false,
      },
      { unassignedAccess: OPEN, unassignedNotice: <p>{NOTICE}</p> },
    );

    expect(mocks.replace).toHaveBeenCalledWith('/onboarding/profile');
    expect(text).not.toContain(CHILD);
  });

  it('판단에 쓴 세션 스냅샷을 자식에게 그대로 물려준다', async () => {
    const snapshot = {
      ...state({
        status: 'unassigned',
        staffAccessRequestStatus: 'PENDING',
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

    await act(() => {
      root.render(
        <RoleGate allow={['student']} unassignedAccess={OPEN}>
          <Probe />
        </RoleGate>,
      );
      return Promise.resolve();
    });

    expect(received).toBe(snapshot);
    expect(mocks.useSessionRole).toHaveBeenCalledTimes(1);
  });
});
