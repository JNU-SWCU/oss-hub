import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StaffAccessRequestStatus } from '@/features/roles/types';
import type { SessionRoleState } from '../_shell/use-session-role';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  useSessionRole: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({
    replace: mocks.replace,
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('../_shell/use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));

import SettingsPage from './page';
import { SETTINGS_ONBOARDING_NOTICE_HEADING } from './settings-onboarding-notice';
import {
  SETTINGS_SAVED_NOTIFICATION as SAVED_NOTIFICATION,
  SETTINGS_SAVED_PROFILE as SAVED_PROFILE,
} from './settings-test-fixtures';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('설정 화면', () => {
  let container: HTMLDivElement;
  let root: Root;
  let requests: { url: string; method: string; body: unknown }[];

  let notificationResponder: () => Response;

  function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.useSessionRole.mockReset();
    requests = [];
    notificationResponder = () => jsonResponse(SAVED_NOTIFICATION);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const body: Record<string, unknown> | null =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        requests.push({ url, method, body });
        if (url.endsWith('/users/me/profile')) {
          return jsonResponse(
            method === 'GET' ? SAVED_PROFILE : { ...SAVED_PROFILE, ...body },
          );
        }
        if (url.endsWith('/users/me/notification-email')) {
          return notificationResponder();
        }
        throw new Error(`예상하지 못한 요청: ${method} ${url}`);
      }),
    );
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(overrides: Partial<SessionRoleState>): Promise<void> {
    mocks.useSessionRole.mockReturnValue({
      status: 'loading',
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
      staffAccessRequestStatus: null,
      staffAccessRequestRejectionReason: null,
      selectedRole: null,
      isProfileComplete: false,
      ...overrides,
      retry: () => {},
    });
    await act(async () => root.render(<SettingsPage />));
  }

  function renderStaffAwaitingRole(
    staffAccessRequestStatus: StaffAccessRequestStatus = 'PENDING',
  ): Promise<void> {
    return render({
      status: 'unassigned',
      staffAccessRequestStatus,
      selectedRole: 'STAFF',
    });
  }

  function field(id: string): HTMLInputElement {
    const element = container.querySelector(`#${id}`);
    if (!(element instanceof HTMLInputElement)) {
      throw new TypeError(`입력란을 찾지 못했습니다: ${id}`);
    }
    return element;
  }

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it.each(['PENDING', 'APPROVED'] as const)(
    '역할 요청이 %s 인 교직원은 안내와 함께 폼에 도달하고, 고친 이름이 저장된다',
    async (staffAccessRequestStatus) => {
      await renderStaffAwaitingRole(staffAccessRequestStatus);

      expect(mocks.replace).not.toHaveBeenCalled();
      expect(container.textContent).toContain(
        SETTINGS_ONBOARDING_NOTICE_HEADING,
      );
      expect(field('settings-name').value).toBe(SAVED_PROFILE.name);

      await type(field('settings-name'), '김교직원');
      const form = container.querySelector('form');
      await act(async () => {
        form?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
      });

      const saved = requests.find(
        (request) =>
          request.method === 'PATCH' &&
          request.url.endsWith('/users/me/profile'),
      );
      expect(saved?.body).toMatchObject({ name: '김교직원' });
      expect(container.textContent).toContain('저장되었습니다');
    },
  );

  it('역할을 기다리는 교직원에게 학번 칸을 보여 주지 않는다', async () => {
    await renderStaffAwaitingRole();

    expect(container.querySelector('#settings-student-id')).toBeNull();
  });

  it('저장을 누르면 첫 오류 칸으로 포커스를 옮기고, 고친 뒤 다시 누르면 남은 오류 칸으로 옮긴다(R-16)', async () => {
    await render({
      status: 'assigned',
      ...accessFor('STUDENT'),
      isProfileComplete: true,
    });
    const submit = () =>
      act(async () => {
        container
          .querySelector('form')
          ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          );
      });

    await submit();

    expect(
      container.querySelectorAll('[data-slot="field-error"]'),
    ).toHaveLength(2);

    expect(document.activeElement?.id).toBe('settings-student-id');

    await type(field('settings-student-id'), '123456');
    await submit();

    expect(document.activeElement?.id).toBe('settings-phone');
    expect(requests.some((request) => request.method === 'PATCH')).toBe(false);
  });

  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '역할이 배정된 %s는 안내 없이 설정을 그대로 연다',
    async (role) => {
      await render({
        status: 'assigned',
        ...accessFor(role),
        isProfileComplete: true,
      });

      expect(mocks.replace).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain(
        SETTINGS_ONBOARDING_NOTICE_HEADING,
      );
      expect(field('settings-name').value).toBe(SAVED_PROFILE.name);
    },
  );

  it.each([
    ['역할 요청이 없는 사용자', '/onboarding/role', {}],
    [
      '가입 중 학생을 고른 사용자',
      '/onboarding/role',
      { selectedRole: 'STUDENT' as const },
    ],
    [
      '가입 중 교직원을 고르기만 한 사용자',
      '/onboarding/role',
      { selectedRole: 'STAFF' as const },
    ],
    [
      '반려된 사용자',
      '/onboarding/role',
      { staffAccessRequestStatus: 'REJECTED' },
    ],
    [
      '회수된 사용자',
      '/onboarding/role',
      { staffAccessRequestStatus: 'REVOKED' },
    ],
  ] as readonly (readonly [string, string, Partial<SessionRoleState>])[])(
    '%s 에게는 설정을 열지 않고 %s 로 되돌린다',
    async (_label, path, overrides) => {
      await render({ status: 'unassigned', ...overrides });

      expect(mocks.replace).toHaveBeenCalledWith(path);
      expect(container.querySelector('#settings-name')).toBeNull();
      expect(container.textContent).not.toContain(
        SETTINGS_ONBOARDING_NOTICE_HEADING,
      );
    },
  );

  it('비로그인 사용자는 리다이렉트하지 않고 로그인 안내를 보여준다(QA46)', async () => {
    await render({ status: 'anonymous' });

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.querySelector('#settings-name')).toBeNull();
    expect(container.textContent).toContain('로그인이 필요합니다');
  });

  it('세션 조회 실패는 어디로도 보내지 않고 설정도 열지 않는다', async () => {
    await render({ status: 'error' });

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.querySelector('#settings-name')).toBeNull();
    expect(container.textContent).toContain('다시 시도');
  });

  it('조회 중에는 아직 아무것도 판단하지 않는다', async () => {
    await render({ status: 'loading' });

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.querySelector('#settings-name')).toBeNull();
  });
});

function accessFor(role: 'STUDENT' | 'STAFF' | 'ADMIN') {
  return {
    memberKind: role === 'ADMIN' ? null : role,
    hasStaffAccess: role === 'STAFF',
    hasAdminAccess: role === 'ADMIN',
  } as const;
}
