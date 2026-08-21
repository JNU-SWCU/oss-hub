// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoleState } from '../_shell/use-session-role';

const mocks = vi.hoisted(() => ({
  useSessionRole: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../_shell/use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));

import SettingsPage from './page';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const SAVED_PROFILE = {
  name: '김교직',
  studentId: null,
  department: '컴퓨터정보통신공학과',
  isComplete: true,
};
const SAVED_NOTIFICATION = {
  notificationEmail: 'staff@example.com',
  notifyEnabled: true,
};

type RequestRecord = { readonly url: string; readonly method: string };

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function assignedStaffSession(): SessionRoleState {
  return {
    status: 'assigned',
    role: 'STAFF',
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: false,
    roleRequestStatus: null,
    roleRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete: true,
  };
}

describe('설정 알림 흐름', () => {
  let container: HTMLDivElement;
  let root: Root;
  let requests: RequestRecord[];
  let notificationResponder: () => Response;

  beforeEach(() => {
    requests = [];
    notificationResponder = () => jsonResponse(SAVED_NOTIFICATION);
    mocks.useSessionRole.mockReturnValue(assignedStaffSession());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        requests.push({ url, method });
        if (url.endsWith('/users/me/profile')) {
          return jsonResponse(SAVED_PROFILE);
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

  async function render(): Promise<void> {
    await act(async () => root.render(<SettingsPage />));
  }

  function field(id: string): HTMLInputElement {
    const element = container.querySelector(`#${id}`);
    if (!(element instanceof HTMLInputElement)) {
      throw new TypeError(`입력란을 찾지 못했습니다: ${id}`);
    }
    return element;
  }

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find((element) =>
      element.textContent?.includes(label),
    );
    if (!(found instanceof HTMLButtonElement)) {
      throw new TypeError(`버튼을 찾지 못했습니다: ${label}`);
    }
    return found;
  }

  it('알림 설정 조회만 실패하면 그 자리에서 알림만 다시 불러온다', async () => {
    notificationResponder = () => new Response('', { status: 503 });
    await render();

    expect(field('settings-name').value).toBe(SAVED_PROFILE.name);
    expect(container.querySelector('#settings-notification-email')).toBeNull();
    await type(field('settings-name'), '김교직원');
    const profileGetsBefore = requests.filter(
      ({ method, url }) =>
        method === 'GET' && url.endsWith('/users/me/profile'),
    ).length;

    notificationResponder = () => jsonResponse(SAVED_NOTIFICATION);
    await act(async () => button('알림 설정 다시 불러오기').click());

    expect(field('settings-notification-email').value).toBe(
      SAVED_NOTIFICATION.notificationEmail,
    );
    expect(field('settings-name').value).toBe('김교직원');
    expect(
      requests.filter(
        ({ method, url }) =>
          method === 'GET' && url.endsWith('/users/me/profile'),
      ),
    ).toHaveLength(profileGetsBefore);
  });

  it('알림 저장만 실패하면 상태를 단정하지 않고 입력을 보존한다', async () => {
    await render();
    await type(field('settings-notification-email'), 'changed@example.com');
    notificationResponder = () => new Response('', { status: 503 });

    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });

    expect(
      requests.some(
        ({ method, url }) =>
          method === 'PATCH' && url.endsWith('/users/me/profile'),
      ),
    ).toBe(true);
    expect(container.textContent).toContain('프로필은 저장했습니다.');
    expect(container.textContent).not.toContain('이전 값으로 남아 있습니다');
    expect(container.textContent).toContain('저장됐는지 확인하지 못했습니다');
    expect(field('settings-notification-email').value).toBe(
      'changed@example.com',
    );
    expect(container.textContent).not.toContain('저장되었습니다');
  });
});
