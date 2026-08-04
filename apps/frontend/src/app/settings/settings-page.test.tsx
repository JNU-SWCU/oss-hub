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
  /** 알림 채널 응답을 호출별로 바꿔 조회 실패 → 재시도 성공을 재현한다. */
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
      role: null,
      roleRequestStatus: null,
      selectedRole: null,
      isProfileComplete: false,
      ...overrides,
      retry: () => {},
    });
    await act(async () => root.render(<SettingsPage />));
  }

  function renderStaffAwaitingRole(
    roleRequestStatus: RoleRequestStatus = 'PENDING',
  ): Promise<void> {
    return render({
      status: 'unassigned',
      roleRequestStatus,
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
   * 신고 그대로의 재현: 역할을 기다리는 교직원이 설정을 열어 이름을 고친다.
   *
   * 안내가 떴는지까지만 보면 부족하다 — 사용자가 원한 것은 안내가 아니라 수정이고,
   * 되돌려보내기를 걷어내도 폼이 학생 기준(학번 필수)으로 그려지면 저장이 막힌 채
   * 증상만 모양을 바꾼다. 그래서 폼에 값을 넣고 저장까지 눌러 PATCH 본문을 확인한다.
   *
   * `APPROVED`도 함께 본다. 결재가 끝나고 세션에 역할이 아직 오지 않은 사람이 겪는
   * 일은 `PENDING`과 똑같고, 유지보수자가 그 창도 열기로 정했다(2026-08-04).
   */
  it.each(['PENDING', 'APPROVED'] as const)(
    '역할 요청이 %s 인 교직원은 안내와 함께 폼에 도달하고, 고친 이름이 저장된다',
    async (roleRequestStatus) => {
      await renderStaffAwaitingRole(roleRequestStatus);

      // 되돌려보내지 않는다 — 신고된 증상("다시 이 창으로 돌아와지더라구요")이다.
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

  /**
   * 역할을 세션의 `role`(=null)로만 읽으면 가장 엄격한 학생 기준이 적용돼 학번이
   * 필수가 된다. 학번 없이 가입한 교직원은 이름 한 글자를 고치려 해도 저장이
   * 막히므로, 화면을 열어 준 것만으로는 신고가 해결되지 않는다.
   */
  it('역할을 기다리는 교직원에게 학번을 요구하지 않는다', async () => {
    await renderStaffAwaitingRole();

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
      // 반려는 살아 있는 신청이 없어 역할 선택으로 되돌린다(#535).
      '반려된 사용자',
      '/onboarding/role',
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

  function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find((element) =>
      element.textContent?.includes(label),
    );
    if (!(found instanceof HTMLButtonElement)) {
      throw new TypeError(`버튼을 찾지 못했습니다: ${label}`);
    }
    return found;
  }

  /**
   * 회귀 방지 — 알림 설정 조회만 실패했을 때 그 조각을 제자리에서 되살릴 수 있는가(#356).
   *
   * 이전에는 실패를 표시만 하고 끝냈다. 사용자가 할 수 있는 일은 화면 전체를
   * 새로고침하는 것뿐이었고, 그러면 이미 고쳐 둔 프로필 입력이 함께 날아갔다.
   * 그래서 이름을 고쳐 둔 상태에서 재시도를 눌러 본다 — 알림만 다시 부르고,
   * 프로필은 다시 부르지 않으며, 고친 입력이 그대로 남아야 한다.
   */
  it('알림 설정 조회만 실패하면 그 자리에서 알림만 다시 불러온다', async () => {
    notificationResponder = () => new Response('', { status: 503 });
    await render({
      status: 'assigned',
      role: 'STAFF',
      isProfileComplete: true,
    });

    // 프로필은 열려 있고, 알림 자리에는 안내와 재시도 수단이 있다.
    expect(field('settings-name').value).toBe(SAVED_PROFILE.name);
    expect(container.querySelector('#settings-notification-email')).toBeNull();
    expect(container.textContent).toContain('알림 설정을 불러오지 못했습니다.');
    expect(container.textContent).toContain(
      '프로필은 그대로 수정·저장할 수 있고',
    );

    // 사용자가 이미 프로필을 고쳐 둔 상태에서 재시도한다.
    await type(field('settings-name'), '김교직원');
    const profileGetsBefore = requests.filter(
      (request) =>
        request.method === 'GET' && request.url.endsWith('/users/me/profile'),
    ).length;

    notificationResponder = () => jsonResponse(SAVED_NOTIFICATION);
    await act(async () => {
      button('알림 설정 다시 불러오기').click();
    });

    // 알림 섹션이 살아나고, 고쳐 둔 이름은 그대로다.
    expect(field('settings-notification-email').value).toBe(
      SAVED_NOTIFICATION.notificationEmail,
    );
    expect(field('settings-name').value).toBe('김교직원');
    // 프로필은 다시 부르지 않는다 — 전체 재조회였다면 입력이 날아갔을 것이다.
    expect(
      requests.filter(
        (request) =>
          request.method === 'GET' && request.url.endsWith('/users/me/profile'),
      ).length,
    ).toBe(profileGetsBefore);
  });

  /**
   * 프로필은 저장됐는데 알림 저장만 실패한 부분 성공. 안내가 "무엇이 저장됐고
   * 알림 설정은 지금 어떤 상태이며 지금 무엇을 하면 되는지"를 말해야 하고,
   * 그 안내가 약속한 대로 입력한 값이 화면에 남아 있어야 한다(#356).
   *
   * 503은 백엔드가 값을 쓴 **뒤에** 터졌을 수도 있는 응답이라, 화면은 알림 값이
   * 이전 값 그대로라고 단정하면 안 된다 — 확인 방법을 주는 데까지가 이 화면의 몫이다.
   */
  it('알림 저장만 실패하면 상태를 단정하지 않고 확인 방법을 알리며 입력을 보존한다', async () => {
    await render({
      status: 'assigned',
      role: 'STAFF',
      isProfileComplete: true,
    });

    await type(field('settings-notification-email'), 'changed@example.com');
    notificationResponder = () => new Response('', { status: 503 });

    const form = container.querySelector('form');
    await act(async () => {
      form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    // 프로필 PATCH는 실제로 나갔다 — "프로필은 저장했다"는 문구가 참이어야 한다.
    expect(
      requests.some(
        (request) =>
          request.method === 'PATCH' &&
          request.url.endsWith('/users/me/profile'),
      ),
    ).toBe(true);
    expect(container.textContent).toContain('프로필은 저장했습니다.');
    // 거짓일 수 있는 단정을 하지 않는다 — 503은 쓰기 뒤에 터졌을 수 있다.
    expect(container.textContent).not.toContain('이전 값으로 남아 있습니다');
    expect(container.textContent).toContain('저장됐는지 확인하지 못했습니다');
    expect(container.textContent).toContain('저장을 다시 눌러 주세요.');
    expect(container.textContent).toContain(
      '설정 화면을 새로 열어 지금 저장된 값을 확인',
    );
    // 입력을 되돌리지 않는다 — 안내가 그렇게 약속했다.
    expect(field('settings-notification-email').value).toBe(
      'changed@example.com',
    );
    expect(container.textContent).not.toContain('저장되었습니다');
  });
});
