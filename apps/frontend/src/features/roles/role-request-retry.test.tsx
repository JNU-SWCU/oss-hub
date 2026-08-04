// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.replace,
    push: vi.fn(),
    refresh: mocks.refresh,
  }),
}));

import {
  ROLE_REQUEST_RETRY_FAILURE_MESSAGE,
  RoleRequestScreen,
} from './components/role-request-screen';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/**
 * 재요청이 **실제로 실패했을 때** 화면에 무엇이 남는가.
 *
 * 문구 상수를 직접 넣어 보는 시험은 이 자리를 못 지킨다. 실패 경로가 상수를 쓰지
 * 않고 서버 문장을 그대로 뿌려도 그 시험은 통과하기 때문이다. 그래서 여기서는
 * 진짜 오류 응답을 fetch로 흘려 넣고, 버튼을 눌러, 화면에 찍힌 글자를 본다.
 */
describe('교직원 재요청 실패 안내', () => {
  const REJECTED_REQUEST = {
    requestedRole: 'STAFF',
    status: 'REJECTED',
    requestedAt: '2026-07-21T00:00:00.000Z',
    decidedAt: '2026-07-21T01:00:00.000Z',
    rejectionReason: '합성 반려 사유',
  };

  let container: HTMLDivElement;
  let root: Root;
  /** POST /role-requests 응답을 시험마다 바꿔 실패 경로를 갈아 끼운다. */
  let retryResponder: () => Response | Promise<Response>;

  function problemResponse(
    status: number,
    code: string,
    detail: string,
  ): Response {
    return new Response(
      JSON.stringify({
        type: 'about:blank',
        title: '요청 처리 실패',
        status,
        detail,
        instance: 'urn:test:role-requests',
        code,
      }),
      { status, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.refresh.mockReset();
    retryResponder = () =>
      problemResponse(500, 'API_000', '예기치 못한 서버 오류가 발생했습니다.');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.endsWith('/role-requests/me')) {
          return new Response(JSON.stringify(REJECTED_REQUEST), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (method === 'POST' && url.endsWith('/role-requests')) {
          return retryResponder();
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

  async function renderRejectedScreen(): Promise<void> {
    await act(async () => root.render(<RoleRequestScreen />));
    expect(container.querySelector('[data-status="REJECTED"]')).not.toBeNull();
  }

  async function clickRetry(): Promise<void> {
    const button = [...container.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('다시 승인 요청하기'),
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new TypeError('재요청 버튼을 찾지 못했습니다.');
    }
    await act(async () => {
      button.click();
    });
  }

  /**
   * 회귀 방지 — 이 PR 직전의 결함이다.
   *
   * 실패 경로가 `error.message`를 그대로 뿌리던 때에는, 사용자가 읽는 것이
   * 서버 한 문장뿐이었다. 무엇을 누르면 되는지가 어디에도 없어 이 PR이 새로 쓴
   * 안내는 정작 진짜 오류에서 한 번도 나오지 않았다.
   */
  it('서버 오류(500)에서도 다음에 누를 버튼을 함께 알린다', async () => {
    await renderRejectedScreen();
    await clickRetry();

    // 서버가 준 원인은 살린다 — 우리 문구로 덮으면 무슨 일이 났는지가 사라진다.
    expect(container.textContent).toContain(
      '예기치 못한 서버 오류가 발생했습니다.',
    );
    // 그리고 다음 행동이 반드시 붙는다.
    expect(container.textContent).toContain(
      '잠시 후 아래 ‘다시 승인 요청하기’를 눌러 주세요.',
    );
  });

  /**
   * 409는 서버 상태가 이미 달라졌다는 뜻이라(대기 중 요청 존재 등) 같은 버튼을
   * 다시 눌러도 같은 답만 온다. 그때는 화면을 최신으로 맞추는 쪽을 가리켜야 한다.
   */
  it('상태 충돌(409)에서는 재시도 대신 상태 새로고침을 가리킨다', async () => {
    retryResponder = () =>
      problemResponse(
        409,
        'ROL_003',
        '처리 중인 교직원 권한 요청이 이미 있습니다.',
      );
    await renderRejectedScreen();
    await clickRetry();

    expect(container.textContent).toContain(
      '처리 중인 교직원 권한 요청이 이미 있습니다.',
    );
    expect(container.textContent).toContain(
      '아래 ‘상태 새로고침’을 눌러 확인해 주세요.',
    );
    // 이 상황에서 "다시 눌러 보라"고 하면 같은 실패를 반복시키는 안내가 된다.
    expect(container.textContent).not.toContain(
      '잠시 후 아래 ‘다시 승인 요청하기’를 눌러 주세요.',
    );
  });

  /** 응답 자체를 못 받은 실패는 원인이 없으니 우리 기본 안내로 떨어진다. */
  it('연결이 끊긴 실패에는 상태를 단정하지 않는 기본 안내를 쓴다', async () => {
    retryResponder = () => Promise.reject(new TypeError('Failed to fetch'));
    await renderRejectedScreen();
    await clickRetry();

    expect(container.textContent).toContain(ROLE_REQUEST_RETRY_FAILURE_MESSAGE);
  });
});
