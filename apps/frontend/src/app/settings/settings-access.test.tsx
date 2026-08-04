// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  roleGateRedirectPath,
  shouldOpenForUnassigned,
} from '../_shell/role-gate';
import SettingsPage from './page';
import { SETTINGS_ALLOWED_ROLES } from './settings-access';
import {
  SETTINGS_ONBOARDING_NOTICE_BODY,
  SETTINGS_ONBOARDING_NOTICE_HEADING,
  SettingsOnboardingNotice,
} from './settings-onboarding-notice';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

// 설정 화면이 쓰는 판단은 `RoleGate`가 쓰는 것과 같은 함수다. 허용 역할 목록은
// 이동 여부에 관여하지 않으므로(권한 불일치는 안내 화면이 맡는다) 넘기지 않는다.
function settingsRedirect(state: SessionRoleState): string | null {
  return roleGateRedirectPath(state);
}

describe('설정 화면 접근 규칙', () => {
  /**
   * 설정은 미배정 사용자에게도 열린다(#581) — 안내를 넘긴 화면이기 때문이다.
   *
   * 이동 판단 자체(`roleGateRedirectPath`)는 그대로다. 달라진 것은 설정이 그 판단에
   * 도달하지 않는다는 점이라, 여기서는 "판단은 이 값이지만 설정은 열린다"를 함께
   * 못 박는다. 한쪽만 보면 게이트를 고칠 때 다른 쪽이 조용히 어긋난다.
   */
  it.each([
    { roleRequestStatus: null, path: '/onboarding/role' },
    { roleRequestStatus: 'PENDING' as const, path: '/onboarding/pending' },
    { roleRequestStatus: 'APPROVED' as const, path: '/onboarding/pending' },
    { roleRequestStatus: 'REJECTED' as const, path: '/onboarding/pending' },
    { roleRequestStatus: 'REVOKED' as const, path: '/onboarding/role' },
  ])(
    '$roleRequestStatus 미배정 사용자의 온보딩 목적지는 $path 이지만 설정은 열어 준다',
    ({ roleRequestStatus, path }) => {
      const state: SessionRoleState = {
        status: 'unassigned',
        role: null,
        roleRequestStatus,
        selectedRole: null,
        isProfileComplete: true,
      };

      expect(settingsRedirect(state)).toBe(path);
      expect(shouldOpenForUnassigned(state.status, true)).toBe(true);
    },
  );

  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '역할이 배정된 %s는 설정을 그대로 연다',
    (role) => {
      const state: SessionRoleState = {
        status: 'assigned',
        role,
        roleRequestStatus: null,
        selectedRole: null,
        isProfileComplete: true,
      };

      expect(settingsRedirect(state)).toBeNull();
      expect(SETTINGS_ALLOWED_ROLES).toContain(role);
    },
  );

  it('비로그인 사용자는 기존대로 랜딩으로 보낸다', () => {
    expect(
      settingsRedirect({
        status: 'anonymous',
        role: null,
        roleRequestStatus: null,
        selectedRole: null,
        isProfileComplete: true,
      }),
    ).toBe('/');
  });

  // 회귀 방지: 조회 실패를 미배정으로 오인하면, 역할을 모르는 채로 프로필 폼이
  // 열려 학생 기준(학번 필수)으로 그려진다.
  it('세션 조회 실패는 어디로도 보내지 않고 설정도 열지 않는다', () => {
    expect(
      settingsRedirect({
        status: 'error',
        role: null,
        roleRequestStatus: null,
        selectedRole: null,
        isProfileComplete: true,
      }),
    ).toBeNull();
    expect(shouldOpenForUnassigned('error', true)).toBe(false);
  });

  it('조회 중에는 아직 판단하지 않는다', () => {
    expect(
      settingsRedirect({
        status: 'loading',
        role: null,
        roleRequestStatus: null,
        selectedRole: null,
        isProfileComplete: true,
      }),
    ).toBeNull();
  });
});

describe('SettingsOnboardingNotice', () => {
  it('무엇을 할 수 있는지 말한다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).toContain(SETTINGS_ONBOARDING_NOTICE_HEADING);
    expect(html).toContain(SETTINGS_ONBOARDING_NOTICE_BODY);
    expect(SETTINGS_ONBOARDING_NOTICE_HEADING).toContain('가입');
  });

  // "권한이 없습니다"는 사용자가 다음에 무엇을 할지 알려주지 않는다.
  it('막연한 권한 문구로 끝내지 않는다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).not.toContain('권한이 없');
  });

  // 화면을 열어 주는 안내로 바뀐 뒤로는 "이동합니다"가 거짓말이다.
  it('되돌아간다고 말하지 않는다', () => {
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).not.toContain('이동');
  });

  it('화면이 바뀌는 것을 보조기술에도 알린다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});

/**
 * 신고 그대로의 재현: 승인을 기다리는 교직원이 설정을 열어 이름을 고친다.
 *
 * 안내가 떴는지까지만 보면 부족하다 — 사용자가 원한 것은 안내가 아니라 수정이고,
 * 되돌려보내기를 걷어내도 폼이 학생 기준(학번 필수)으로 그려지면 저장이 막힌 채
 * 증상만 모양을 바꾼다. 그래서 폼에 값을 넣고 저장까지 눌러 PATCH 본문을 확인한다.
 */
describe('승인 대기 교직원의 설정 수정', () => {
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

  async function renderPendingStaffSettings(): Promise<void> {
    mocks.useSessionRole.mockReturnValue({
      status: 'unassigned',
      role: null,
      roleRequestStatus: 'PENDING',
      selectedRole: 'STAFF',
      isProfileComplete: false,
      retry: () => {},
    } satisfies SessionRoleState & { retry: () => void });
    await act(async () => root.render(<SettingsPage />));
  }

  it('안내와 함께 설정 폼에 도달하고, 고친 이름이 저장된다', async () => {
    await renderPendingStaffSettings();

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
  it('학번을 요구하지 않는다 — 승인 대기 교직원은 교직원 기준으로 본다', async () => {
    await renderPendingStaffSettings();

    expect(field('settings-student-id').value).toBe('');
    expect(container.textContent).toContain('학번이 있으면 입력합니다');
    expect(container.textContent).not.toContain('숫자 6~10자리로 입력합니다');
  });
});
