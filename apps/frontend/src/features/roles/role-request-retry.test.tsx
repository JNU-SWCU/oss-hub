// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  const refresh = vi.fn();
  const push = vi.fn();
  // ⚠ 한 번 만든 객체를 계속 돌려준다. 렌더마다 새 객체를 주면 `useRouter()` 결과의
  // 참조가 바뀌고, 그 값을 의존성으로 갖는 `loadRequest`(useCallback)와 그것을
  // 의존성으로 갖는 useEffect 가 매 렌더 다시 돌아 무한 루프가 된다 — 실제로 이
  // 파일이 힙을 소진시켜 CI 가 OOM 으로 죽었다. 실제 next/navigation 의 router 도
  // 렌더 간 안정적인 참조다.
  return { replace, refresh, push, router: { replace, refresh, push } };
});

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
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
  /** 화면 일부가 아니라 공통 세션·역할 스냅샷을 다시 읽는 동작. */
  let refreshShared: ReturnType<typeof vi.fn>;
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
    refreshShared = vi.fn();
    retryResponder = () =>
      problemResponse(500, 'API_000', '예기치 못한 서버 오류가 발생했습니다.');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
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
    await act(async () =>
      root.render(
        <RoleRequestScreen
          roleRequestStatus="REJECTED"
          roleRequestRejectionReason="합성 반려 사유"
          onRefresh={refreshShared}
        />,
      ),
    );
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

  /**
   * 실패 안내는 그때의 서버 상태를 말한다. 상태를 다시 불러오면 그 말은 더 이상
   * 지금을 설명하지 않는다. 게다가 그 안내가 '상태 새로고침'을 눌러 확인하라고
   * 직접 가리키므로, 눌러도 같은 경고가 남으면 사용자는 안내를 따랐는데 아무 일도
   * 일어나지 않은 것으로 읽는다.
   */
  it('상태를 다시 불러오면 이전 실패 안내가 남지 않는다', async () => {
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

    const refresh = [...container.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('상태 새로고침'),
    );
    if (!(refresh instanceof HTMLButtonElement)) {
      throw new TypeError('상태 새로고침 버튼을 찾지 못했습니다.');
    }
    await act(async () => {
      refresh.click();
    });

    expect(container.textContent).not.toContain(
      '처리 중인 교직원 권한 요청이 이미 있습니다.',
    );
    // 화면 자체는 살아 있어야 한다 — 경고만 사라지고 상태는 다시 그려진다.
    expect(container.querySelector('[data-status="REJECTED"]')).not.toBeNull();
    expect(refreshShared).toHaveBeenCalledOnce();
  });

  /**
   * 재요청이 날아가 있는 동안 새로고침을 누를 수 있으면, 경고를 지웠다가 뒤늦게
   * 도착한 실패가 그 위에 다시 경고를 그린다 — 눌러서 사라진 것이 저절로
   * 되살아난 것으로 보인다. 진행 중에는 아예 못 누르게 막는다.
   */
  it('재요청이 진행 중이면 상태 새로고침을 눌러도 상태를 다시 읽지 않는다', async () => {
    let releaseRetry: (() => void) | undefined;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    retryResponder = async () => {
      await retryGate;
      return problemResponse(500, 'API_000', '서버 오류');
    };
    await renderRejectedScreen();

    const refresh = (): HTMLButtonElement => {
      const found = [...container.querySelectorAll('button')].find((element) =>
        element.textContent?.includes('상태 새로고침'),
      );
      if (!(found instanceof HTMLButtonElement)) {
        throw new TypeError('상태 새로고침 버튼을 찾지 못했습니다.');
      }
      return found;
    };
    const retryButton = [...container.querySelectorAll('button')].find(
      (element) => element.textContent?.includes('다시 승인 요청하기'),
    );
    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new TypeError('재요청 버튼을 찾지 못했습니다.');
    }

    expect(refresh().disabled).toBe(false);
    const refreshesBeforeRetry = refreshShared.mock.calls.length;

    // 응답을 게이트로 붙잡아 둔 채 재요청을 띄운다. act 안에서 클릭까지만 흘려보내고
    // 응답은 기다리지 않는다 — 요청이 떠 있는 동안의 화면을 봐야 하기 때문이다.
    await act(async () => {
      retryButton.click();
      await Promise.resolve();
    });

    expect(refresh().disabled).toBe(true);

    // 속성만 보지 않고 실제로 눌러 본다. 막혀 있다면 상태를 다시 읽지 않아야 한다.
    await act(async () => {
      refresh().click();
      await Promise.resolve();
    });
    expect(refreshShared).toHaveBeenCalledTimes(refreshesBeforeRetry);

    // 응답을 풀면 잠금이 해제되고, 그때는 눌러서 실제로 다시 읽힌다.
    releaseRetry?.();
    await act(async () => {
      await retryGate;
      await Promise.resolve();
    });
    expect(refresh().disabled).toBe(false);

    await act(async () => {
      refresh().click();
      await Promise.resolve();
    });
    expect(refreshShared).toHaveBeenCalledTimes(refreshesBeforeRetry + 1);
  });

  it('재요청 성공도 로컬 값만 바꾸지 않고 공통 스냅샷을 갱신한다', async () => {
    retryResponder = () =>
      new Response(
        JSON.stringify({
          ...REJECTED_REQUEST,
          status: 'PENDING',
          decidedAt: null,
          rejectionReason: null,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    await renderRejectedScreen();

    await clickRetry();

    expect(refreshShared).toHaveBeenCalledOnce();
  });
});
