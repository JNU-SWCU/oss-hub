// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileRole } from './profile-requirements';

/**
 * `router`는 렌더마다 같은 객체여야 한다 — 화면의 조회 effect가 그 참조를 의존성으로
 * 들고 있어(`loadProfile`), 매번 새 객체를 돌려주면 조회 → 상태 갱신 → 재조회가 끝없이
 * 돈다. 실제 App Router는 참조를 고정해서 준다.
 */
const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    replace,
    assign: vi.fn(),
    router: { replace, push: vi.fn(), refresh: vi.fn() },
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));

import { ProfileOnboardingScreen } from './components/profile-onboarding-screen';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/**
 * 화면을 실제로 마운트해서 본다 — 헬퍼만으로는 잡히지 않는 자리라서다.
 *
 * `validateProfileForm`이 옳아도 화면이 저장된 학번을 넘겨주지 않으면 사용자는 그대로
 * 막힌다. 이 저장소가 반복해서 겪은 실패라(설정 화면은 저장된 학번을 예외로 두는데
 * 온보딩 화면만 그 원칙이 빠져 있었다) 검증은 화면 쪽에 둔다.
 */
describe('프로필 온보딩 화면', () => {
  /**
   * 형식이 강화되기 전에 저장된 학번(#835 이전에는 6~10자리를 받았다).
   *
   * 실재하는 학번이 아니라 자릿수만 맞춘 합성값이다.
   */
  const LEGACY_STUDENT_ID = '9'.repeat(9);
  const NEXT_PATH = '/student';

  let container: HTMLDivElement;
  let root: Root;
  let requests: { method: string; body: unknown }[];
  let profileResponder: (method: string, body: unknown) => Response;

  function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function profile(overrides: Record<string, unknown> = {}): unknown {
    return {
      name: '합성 학생',
      studentId: LEGACY_STUDENT_ID,
      department: '인공지능학부',
      isComplete: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.assign.mockReset();
    requests = [];
    profileResponder = () => jsonResponse(profile());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const body =
          typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        requests.push({ method, body });
        return profileResponder(method, body);
      }),
    );
    // happy-dom의 location은 실제로 이동을 시도하므로 이동 요청만 가로챈다.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        assign: mocks.assign,
        search: '',
        pathname: '/onboarding/profile',
      },
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

  async function render(role: ProfileRole | null = 'STUDENT'): Promise<void> {
    await act(async () => {
      root.render(<ProfileOnboardingScreen role={role} nextPath={NEXT_PATH} />);
    });
  }

  function optionalField(id: string): HTMLInputElement | null {
    const element = container.querySelector(`#${id}`);
    return element instanceof HTMLInputElement ? element : null;
  }

  function field(id: string): HTMLInputElement {
    const element = optionalField(id);
    if (!element) {
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

  async function select(id: string, value: string): Promise<void> {
    const element = container.querySelector(`#${id}`);
    if (!(element instanceof HTMLSelectElement)) {
      throw new TypeError(`선택란을 찾지 못했습니다: ${id}`);
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function submit(): Promise<void> {
    const form = container.querySelector('form');
    await act(async () => {
      form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
  }

  function savedRequest(): { method: string; body: unknown } | undefined {
    return requests.find((request) => request.method === 'PATCH');
  }

  const STUDENT_ID_ERROR = '학번은 숫자 6자리로 입력해 주세요.';

  /**
   * 신고 그대로의 재현 — 예전 형식 학번을 가진 학생이 온보딩에 갇힌다.
   *
   * 이미 저장된 학번은 형식이 지금 규칙과 달라도 완료된 프로필이다. 화면은 이 사람을
   * 붙잡지 않고 다음 자리로 보내야 한다. 붙잡으면 학번은 바꿀 수 없는 항목이라
   * (`USR_003`) 빠져나갈 방법이 아예 없다.
   */
  it('저장된 학번이 예전 형식이어도 완료된 학생을 붙잡지 않는다', async () => {
    await render();

    expect(mocks.replace).toHaveBeenCalledWith(NEXT_PATH);
    expect(container.textContent).not.toContain(STUDENT_ID_ERROR);
    expect(container.textContent).not.toContain('프로필을 불러오지 못했습니다');
  });

  /**
   * 학과가 비어 아직 미완료인 예전 형식 학번 사용자.
   *
   * 이 사람은 화면에 남아야 한다(학과를 받아야 하므로). 다만 막는 이유가 학과여야지
   * 학번이어서는 안 된다 — 학번은 고칠 수 없는 값이라 그 오류는 출구가 없다.
   */
  it('예전 형식 학번은 오류로 표시하지 않고 학과만 받는다', async () => {
    profileResponder = (method, body) =>
      method === 'GET'
        ? jsonResponse(profile({ department: null, isComplete: false }))
        : jsonResponse(profile({ ...(body as object), isComplete: true }));

    await render();

    expect(field('profile-student-id').value).toBe(LEGACY_STUDENT_ID);
    expect(container.textContent).not.toContain(STUDENT_ID_ERROR);

    await select('profile-department', '인공지능학부');
    await submit();

    // 저장된 학번은 요청에 싣지 않는다 — 백엔드 DTO가 6자리만 받고(400), 학번은
    // 어차피 바꿀 수 없는 항목이다. 설정 화면이 이미 그렇게 한다.
    expect(savedRequest()?.body).toEqual({
      name: '합성 학생',
      department: '인공지능학부',
    });
    expect(mocks.assign).toHaveBeenCalledWith(NEXT_PATH);
  });

  /** 저장된 값을 통과시킨다고 새로 입력하는 값까지 열리면 잘못된 학번이 들어온다. */
  it('새로 입력하는 학번은 그대로 6자리를 요구한다', async () => {
    profileResponder = (method, body) =>
      method === 'GET'
        ? jsonResponse(
            profile({ studentId: null, department: null, isComplete: false }),
          )
        : jsonResponse(profile({ ...(body as object), isComplete: true }));

    await render();

    await type(field('profile-student-id'), '1'.repeat(5));
    await select('profile-department', '인공지능학부');
    await submit();

    expect(container.textContent).toContain(STUDENT_ID_ERROR);
    expect(savedRequest()).toBeUndefined();

    await type(field('profile-student-id'), '1'.repeat(6));
    await submit();

    expect(savedRequest()?.body).toEqual({
      name: '합성 학생',
      studentId: '1'.repeat(6),
      department: '인공지능학부',
    });
  });

  /**
   * 저장된 학번을 사용자가 **고쳐 넣었다면** 그것은 새 값이다 — 형식을 다시 본다.
   *
   * 예외의 근거는 "이미 저장된 값이라 사용자가 만들 수 있는 오류가 아니다"이지,
   * "학번 칸은 검증하지 않는다"가 아니다.
   */
  it('저장된 학번을 고쳐 넣으면 다시 형식을 검증한다', async () => {
    profileResponder = (method, body) =>
      method === 'GET'
        ? jsonResponse(profile({ department: null, isComplete: false }))
        : jsonResponse(profile({ ...(body as object), isComplete: true }));

    await render();

    await type(field('profile-student-id'), '1'.repeat(5));
    await select('profile-department', '인공지능학부');
    await submit();

    expect(container.textContent).toContain(STUDENT_ID_ERROR);
    expect(savedRequest()).toBeUndefined();
  });
});
