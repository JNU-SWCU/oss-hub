import { act } from 'react';
import { createQueryRoot as createRoot } from '../../../test-support/render-with-query';
type Root = ReturnType<typeof createRoot>;
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoleState } from '../_shell/use-session-role';
import { featureKey } from '@/lib/query-keys';

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
import {
  SETTINGS_SAVED_NOTIFICATION as SAVED_NOTIFICATION,
  SETTINGS_SAVED_PROFILE as SAVED_PROFILE,
} from './settings-test-fixtures';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

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
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: false,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete: true,
  };
}

describe('설정 알림 흐름', () => {
  let container: HTMLDivElement;
  let root: Root;
  let requests: RequestRecord[];
  let notificationResponder: () => Response | Promise<Response>;
  let profileResponder: () => Response | Promise<Response>;

  beforeEach(() => {
    requests = [];
    profileResponder = () => jsonResponse(SAVED_PROFILE);
    notificationResponder = () => jsonResponse(SAVED_NOTIFICATION);
    mocks.useSessionRole.mockReturnValue(assignedStaffSession());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        requests.push({ url, method });
        if (url.endsWith('/users/me/profile')) {
          return profileResponder();
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
    root.queryClient.setQueryDefaults(featureKey('profile'), {
      gcTime: Infinity,
    });
    root.queryClient.setQueryDefaults(featureKey('notification-channel'), {
      gcTime: Infinity,
    });
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
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, value);
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
    expect(container.textContent).toContain('저장 여부는 확인하지 못했습니다');
    expect(field('settings-notification-email').value).toBe(
      'changed@example.com',
    );
    expect(container.textContent).not.toContain('저장되었습니다');
  });
  function submitForm(): void {
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  it('프로필과 알림 저장 전체 기간 입력을 잠그고 완료 후 편집하면 성공 표시를 지운다', async () => {
    await render();
    const profile = Promise.withResolvers<Response>();
    const notification = Promise.withResolvers<Response>();
    profileResponder = () => profile.promise;
    notificationResponder = () => notification.promise;
    await act(async () => submitForm());
    expect(
      field('settings-name').closest('form')?.querySelector('fieldset')
        ?.disabled,
    ).toBe(true);
    expect(
      field('settings-notification-email')
        .closest('form')
        ?.querySelector('fieldset')?.disabled,
    ).toBe(true);
    await act(async () => profile.resolve(jsonResponse(SAVED_PROFILE)));
    expect(
      field('settings-name').closest('form')?.querySelector('fieldset')
        ?.disabled,
    ).toBe(true);
    await act(async () =>
      notification.resolve(jsonResponse(SAVED_NOTIFICATION)),
    );
    expect(container.textContent).toContain('저장되었습니다.');
    expect(
      root.queryClient.getQueryState(featureKey('profile'))?.isInvalidated,
    ).toBe(true);
    expect(
      root.queryClient.getQueryState(featureKey('notification-channel'))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      field('settings-name').closest('form')?.querySelector('fieldset')
        ?.disabled,
    ).toBe(false);
    await type(field('settings-name'), '합성 수정');
    expect(container.textContent).not.toContain('저장되었습니다.');
  });

  it('재조회와 저장은 같은 이벤트 루프에서도 양방향으로 진입을 막는다', async () => {
    notificationResponder = () => new Response('', { status: 503 });
    await render();
    const notification = Promise.withResolvers<Response>();
    notificationResponder = () => notification.promise;
    await act(async () => {
      button('알림 설정 다시 불러오기').click();
      submitForm();
    });
    expect(requests.filter(({ method }) => method === 'PATCH')).toHaveLength(0);
    expect(button('저장').disabled).toBe(true);
    await act(async () =>
      notification.resolve(new Response('', { status: 503 })),
    );
    const profile = Promise.withResolvers<Response>();
    profileResponder = () => profile.promise;
    const readsBefore = requests.filter(
      ({ method, url }) =>
        method === 'GET' && url.endsWith('/notification-email'),
    ).length;
    await act(async () => {
      submitForm();
      button('알림 설정 다시 불러오기').click();
    });
    expect(
      requests.filter(
        ({ method, url }) =>
          method === 'GET' && url.endsWith('/notification-email'),
      ),
    ).toHaveLength(readsBefore);
    expect(button('알림 설정 다시 불러오기').disabled).toBe(true);
    await act(async () => profile.resolve(jsonResponse(SAVED_PROFILE)));
  });
});
