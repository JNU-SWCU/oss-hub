// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoleRequestStatus } from '@/features/roles/types';
import type { SessionRoleState } from '../_shell/use-session-role';

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

vi.mock('../_shell/use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));

import SettingsPage from './page';
import { SETTINGS_ONBOARDING_NOTICE_HEADING } from './settings-onboarding-notice';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/**
 * 조합된 화면을 실제로 마운트해 본다.
 *
 * 규칙 하나(`settings-access.test.ts`)와 게이트 하나(`_shell/role-gate.test.tsx`)가
 * 각각 옳아도, `page.tsx`가 규칙을 게이트에 물려주지 않으면 화면은 그대로 뚫린다.
 * 여기서 보는 것은 그 배선과, 열린 다음 사용자가 실제로 저장까지 가는지다.
 */
describe('설정 화면', () => {
  const SAVED_PROFILE = {
    name: '김교직',
    studentId: null,
    department: '컴퓨터정보통신공학과',
    isComplete: true,
  };
  const SAVED_NOTIFICATION = {
    // 실제 도메인 주소는 쓰지 않는다 — `docs/rules/security.md` 의 deny-list 3번이
    // 연락처 이메일을 금지하고, RFC 2606 예약 도메인의 합성 예시만 허용한다.
    notificationEmail: 'staff@example.com',
    notifyEnabled: true,
  };

  let container: HTMLDivElement;
  let root: Root;
  let requests: { url: string; method: string; body: unknown }[];

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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        requests.push({
          url,
          method,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        });
        if (url.endsWith('/users/me/profile')) {
          return jsonResponse(
            method === 'GET'
              ? SAVED_PROFILE
              : {
                  ...SAVED_PROFILE,
                  ...(JSON.parse(String(init?.body)) as object),
                },
          );
        }
        if (url.endsWith('/users/me/notification-email')) {
          return jsonResponse(SAVED_NOTIFICATION);
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
      role: null,
      roleRequestStatus: null,
      selectedRole: null,
      isProfileComplete: false,
      ...overrides,
      retry: () => {},
    });
    await act(async () => root.render(<SettingsPage />));
  }

  function renderPendingStaff(): Promise<void> {
    return render({
      status: 'unassigned',
      roleRequestStatus: 'PENDING',
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

  /** React가 듣는 것은 네이티브 input 이벤트라 setter를 직접 호출해 값을 넣는다. */
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

  /**
   * 신고 그대로의 재현: 승인을 기다리는 교직원이 설정을 열어 이름을 고친다.
   *
   * 안내가 떴는지까지만 보면 부족하다 — 사용자가 원한 것은 안내가 아니라 수정이고,
   * 되돌려보내기를 걷어내도 폼이 학생 기준(학번 필수)으로 그려지면 저장이 막힌 채
   * 증상만 모양을 바꾼다. 그래서 폼에 값을 넣고 저장까지 눌러 PATCH 본문을 확인한다.
   */
  it('승인 대기 교직원은 안내와 함께 폼에 도달하고, 고친 이름이 저장된다', async () => {
    await renderPendingStaff();

    // 되돌려보내지 않는다 — 신고된 증상("다시 이 창으로 돌아와지더라구요")이다.
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain(SETTINGS_ONBOARDING_NOTICE_HEADING);
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
        request.method === 'PATCH' && request.url.endsWith('/users/me/profile'),
    );
    expect(saved?.body).toMatchObject({ name: '김교직원' });
    expect(container.textContent).toContain('저장되었습니다');
  });

  /**
   * 역할을 세션의 `role`(=null)로만 읽으면 가장 엄격한 학생 기준이 적용돼 학번이
   * 필수가 된다. 학번 없이 가입한 교직원은 이름 한 글자를 고치려 해도 저장이
   * 막히므로, 화면을 열어 준 것만으로는 신고가 해결되지 않는다.
   */
  it('승인 대기 교직원에게 학번을 요구하지 않는다', async () => {
    await renderPendingStaff();

    expect(field('settings-student-id').value).toBe('');
    expect(container.textContent).toContain('학번이 있으면 입력합니다');
    expect(container.textContent).not.toContain('숫자 6~10자리로 입력합니다');
  });

  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '역할이 배정된 %s는 안내 없이 설정을 그대로 연다',
    async (role) => {
      await render({ status: 'assigned', role, isProfileComplete: true });

      expect(mocks.replace).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain(
        SETTINGS_ONBOARDING_NOTICE_HEADING,
      );
      expect(field('settings-name').value).toBe(SAVED_PROFILE.name);
    },
  );

  /**
   * 회귀 방지 — 이 PR 직전의 결함이다.
   *
   * 안내를 준 화면이 곧 "모든 미배정 사용자에게 열린 화면"이던 때에는, 아래 넷이
   * 전부 설정에 들어왔다. 가입을 마치기 전에는 프로필·알림을 고칠 수 없다는 예전
   * 계약(`ed2a187`)이 그대로 뒤집혔던 자리다. #581이 요구한 사람은 승인 대기
   * 교직원 하나뿐이다.
   */
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
      '/onboarding/pending',
      { roleRequestStatus: 'REJECTED' as RoleRequestStatus },
    ],
    [
      '회수된 사용자',
      '/onboarding/role',
      { roleRequestStatus: 'REVOKED' as RoleRequestStatus },
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

  it('비로그인 사용자는 랜딩으로 보내고 설정을 열지 않는다', async () => {
    await render({ status: 'anonymous' });

    expect(mocks.replace).toHaveBeenCalledWith('/');
    expect(container.querySelector('#settings-name')).toBeNull();
  });

  // 회귀 방지: 조회 실패를 미배정으로 오인하면, 역할을 모르는 채로 프로필 폼이
  // 열려 학생 기준(학번 필수)으로 그려진다.
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
