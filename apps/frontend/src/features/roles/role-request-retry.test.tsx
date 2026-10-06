import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  const refresh = vi.fn();
  const push = vi.fn();

  return { replace, refresh, push, router: { replace, refresh, push } };
});

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}));

import {
  ROLE_REQUEST_RETRY_FAILURE_MESSAGE,
  StaffAccessRequestScreen,
} from './components/role-request-screen';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

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

  let refreshShared: ReturnType<typeof vi.fn>;

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
        <StaffAccessRequestScreen
          staffAccessRequestStatus="REJECTED"
          staffAccessRequestRejectionReason="합성 반려 사유"
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

  it('서버 오류(500)에서도 다음에 누를 버튼을 함께 알린다', async () => {
    await renderRejectedScreen();
    await clickRetry();

    expect(container.textContent).toContain(
      '예기치 못한 서버 오류가 발생했습니다.',
    );

    expect(container.textContent).toContain(
      '잠시 후 아래 ‘다시 승인 요청하기’를 눌러 주세요.',
    );
  });

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

    expect(container.textContent).not.toContain(
      '잠시 후 아래 ‘다시 승인 요청하기’를 눌러 주세요.',
    );
  });

  it('연결이 끊긴 실패에는 상태를 단정하지 않는 기본 안내를 쓴다', async () => {
    retryResponder = () => Promise.reject(new TypeError('Failed to fetch'));
    await renderRejectedScreen();
    await clickRetry();

    expect(container.textContent).toContain(ROLE_REQUEST_RETRY_FAILURE_MESSAGE);
  });

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

    expect(container.querySelector('[data-status="REJECTED"]')).not.toBeNull();
    expect(refreshShared).toHaveBeenCalledOnce();
  });

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

    await act(async () => {
      retryButton.click();
      await Promise.resolve();
    });

    expect(refresh().disabled).toBe(true);

    await act(async () => {
      refresh().click();
      await Promise.resolve();
    });
    expect(refreshShared).toHaveBeenCalledTimes(refreshesBeforeRetry);

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
