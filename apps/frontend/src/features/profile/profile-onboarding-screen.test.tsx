import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileMemberKind } from './profile-requirements';

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

describe('프로필 온보딩 화면', () => {
  const LEGACY_STUDENT_ID = '9'.repeat(9);
  const NEXT_PATH = '/student';
  const TEN_DIGIT_PHONE = '1'.repeat(10);

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
      staffNumber: null,
      department: '인공지능학부',
      phone: TEN_DIGIT_PHONE,
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
        const body: unknown =
          typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        requests.push({ method, body });
        return Promise.resolve(profileResponder(method, body));
      }),
    );

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
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(memberKind: ProfileMemberKind = 'STUDENT') {
    await act(() => {
      root.render(
        <ProfileOnboardingScreen
          memberKind={memberKind}
          nextPath={NEXT_PATH}
        />,
      );
      return Promise.resolve();
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
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    await act(() => {
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return Promise.resolve();
    });
  }

  async function select(id: string, value: string): Promise<void> {
    const element = container.querySelector(`#${id}`);
    if (!(element instanceof HTMLSelectElement)) {
      throw new TypeError(`선택란을 찾지 못했습니다: ${id}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    );
    await act(() => {
      descriptor?.set?.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return Promise.resolve();
    });
  }

  async function submit(): Promise<void> {
    const form = container.querySelector('form');
    await act(() => {
      form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      return Promise.resolve();
    });
  }

  function savedRequest(): { method: string; body: unknown } | undefined {
    return requests.find((request) => request.method === 'POST');
  }

  const STUDENT_ID_ERROR = '학번은 숫자 6자리로 입력해 주세요.';

  const PHONE_ERROR = '전화번호는 숫자 10~11자리로 입력해 주세요.';

  it('저장된 학번이 예전 형식이어도 완료된 학생을 붙잡지 않는다', async () => {
    await render();

    expect(mocks.replace).toHaveBeenCalledWith(NEXT_PATH);
    expect(container.textContent).not.toContain(STUDENT_ID_ERROR);
    expect(container.textContent).not.toContain('프로필을 불러오지 못했습니다');
  });

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

    expect(savedRequest()?.body).toEqual({
      name: '합성 학생',
      phone: TEN_DIGIT_PHONE,
      affiliationKind: 'DEPARTMENT',
      affiliationName: '인공지능학부',
    });
    expect(mocks.assign).toHaveBeenCalledWith(NEXT_PATH);
  });

  it('새로 입력하는 학번은 그대로 6자리를 요구한다', async () => {
    profileResponder = (method, body) =>
      method === 'GET'
        ? jsonResponse(
            profile({ studentId: null, department: null, isComplete: false }),
          )
        : jsonResponse(profile({ ...(body as object), isComplete: true }));

    await render();

    await type(field('profile-student-id'), '1'.repeat(5));
    await type(field('profile-phone'), TEN_DIGIT_PHONE);
    await select('profile-department', '인공지능학부');
    await submit();

    expect(container.textContent).toContain(STUDENT_ID_ERROR);
    expect(savedRequest()).toBeUndefined();

    await type(field('profile-student-id'), '1'.repeat(6));
    await submit();

    expect(savedRequest()?.body).toEqual({
      name: '합성 학생',
      studentId: '1'.repeat(6),
      phone: TEN_DIGIT_PHONE,
      affiliationKind: 'DEPARTMENT',
      affiliationName: '인공지능학부',
    });
  });

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

  it('전화번호가 잘못된 학생 제출은 전화번호 입력란에 초점을 둔다', async () => {
    profileResponder = (method, body) =>
      method === 'GET'
        ? jsonResponse(
            profile({
              studentId: null,
              phone: null,
              department: null,
              isComplete: false,
            }),
          )
        : jsonResponse(profile({ ...(body as object), isComplete: true }));

    await render();

    await type(field('profile-student-id'), '1'.repeat(6));
    await type(field('profile-phone'), '1'.repeat(3));
    await select('profile-department', '인공지능학부');
    await submit();

    expect(container.textContent).toContain(PHONE_ERROR);
    expect(document.activeElement).toBe(field('profile-phone'));
    expect(savedRequest()).toBeUndefined();
  });

  it('전화번호 입력값의 구분자를 조용히 숫자로 바꾸지 않는다', async () => {
    profileResponder = (method, body) =>
      method === 'GET'
        ? jsonResponse(
            profile({
              studentId: null,
              phone: null,
              department: null,
              isComplete: false,
            }),
          )
        : jsonResponse(profile({ ...(body as object), isComplete: true }));

    await render();

    await type(field('profile-student-id'), '1'.repeat(6));
    await type(field('profile-phone'), `${'1'.repeat(3)}-${'2'.repeat(4)}`);
    await select('profile-department', '인공지능학부');
    await submit();

    expect(field('profile-phone').value).toContain('-');
    expect(container.textContent).toContain(PHONE_ERROR);
    expect(savedRequest()).toBeUndefined();
  });
});
