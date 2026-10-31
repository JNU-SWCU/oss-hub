import { act } from 'react';
import { renderWithQuery } from '../../../../test-support/render-with-query';
type Root = Awaited<ReturnType<typeof renderWithQuery>>;
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminAccessHistory,
  AdminAccessLoginHistoryItem,
  AdminAccessStaffAccessRequestHistoryItem,
} from './admin-access-api';
import {
  adminDetail,
  adminHistory,
  adminMutation,
  historyPage,
} from './admin-access-detail-test-fixture';
import { fetchAdminAccessHistory } from './admin-access-api';
import { loadAdminAccessDetail } from './admin-access-detail-api';
import { AdminAccessDetailContentForState } from './components/admin-access-detail-content';
import { AdminAccessDetailScreen } from './components/admin-access-detail-screen';

vi.mock('./admin-access-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-access-api')>()),
  fetchAdminAccessHistory: vi.fn(),
}));

vi.mock('./admin-access-detail-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-access-detail-api')>()),
  loadAdminAccessDetail: vi.fn(),
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.resetAllMocks();
  root = await renderWithQuery(null);
  container = root.container;
});

function pagedHistory(label: string, page = 1): AdminAccessHistory {
  return adminHistory({
    staffAccessRequests: historyPage({
      page,
      total: 40,
      items: [
        {
          id: `${label}-request`,
          status: 'REJECTED',
          rejectionReason: label,
          decidedAt: null,
          decidedBy: null,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    }),
    loginHistory: historyPage({ page, total: 40 }),
  });
}

async function renderDetail(userId = 'target') {
  await act(async () => {
    root.render(<AdminAccessDetailScreen userId={userId} />);
  });
}

async function nextHistoryPage(index: number) {
  const button = [...container.querySelectorAll('button')].filter(
    (candidate) => candidate.textContent === '다음',
  )[index];
  if (!button) throw new TypeError('History next button not found');
  await act(async () => button.click());
}

describe('관리자 상세 이력 조회 복구와 사용자 전환', () => {
  it.each(['close', 'switch'])(
    '이력 페이지 요청 중 %s 후 같은 사용자를 다시 열어도 오래된 응답이 덮어쓰지 않는다',
    async (departure) => {
      const oldRequest = Promise.withResolvers<AdminAccessHistory>();
      vi.mocked(loadAdminAccessDetail).mockResolvedValue({
        detail: adminDetail(),
        history: pagedHistory('original-history'),
      });
      vi.mocked(fetchAdminAccessHistory).mockReturnValue(oldRequest.promise);
      await renderDetail();
      await nextHistoryPage(0);
      expect(fetchAdminAccessHistory).toHaveBeenCalledTimes(1);
      if (departure === 'close') await root.rerender(null);
      else await renderDetail('new-target');
      vi.mocked(loadAdminAccessDetail).mockResolvedValue({
        detail: adminDetail(),
        history: pagedHistory('fresh-history'),
      });
      await renderDetail();
      expect(container.textContent).toContain('fresh-history');
      await act(async () => {
        oldRequest.resolve(pagedHistory('stale-history', 2));
        await oldRequest.promise;
      });
      expect(container.textContent).toContain('fresh-history');
      expect(container.textContent).not.toContain('stale-history');
    },
  );

  it.each([0, 1])(
    '이력 %i 페이지 실패는 이전 목록과 재시도를 보존한다',
    async (index) => {
      vi.mocked(loadAdminAccessDetail).mockResolvedValue({
        detail: adminDetail(),
        history: pagedHistory('original-history'),
      });
      vi.mocked(fetchAdminAccessHistory)
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce(pagedHistory('next-history', 2));
      await renderDetail();
      await nextHistoryPage(index);

      expect(container.textContent).toContain('original-history');
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        '이력을 불러오지 못했습니다',
      );
      const retry = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === '다시 시도',
      );
      if (!retry) throw new TypeError('History retry button not found');
      await act(async () => retry.click());

      expect(
        vi.mocked(fetchAdminAccessHistory).mock.calls[1]?.[1],
      ).toMatchObject({
        staffAccessRequestPage: index === 0 ? 2 : 1,
        loginPage: index === 1 ? 2 : 1,
      });
      expect(container.textContent).toContain('next-history');
      expect(container.textContent).not.toContain('original-history');
      expect(container.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it.each(['resolve', 'reject'])(
    '이전 사용자의 늦은 %s는 새 이력과 로딩을 바꾸지 않는다',
    async (outcome) => {
      const oldRequest = Promise.withResolvers<AdminAccessHistory>();
      const newRequest = Promise.withResolvers<AdminAccessHistory>();
      vi.mocked(loadAdminAccessDetail)
        .mockResolvedValueOnce({
          detail: adminDetail(),
          history: pagedHistory('old-user-history'),
        })
        .mockResolvedValueOnce({
          detail: adminDetail({ id: 'new-target', githubLogin: 'new-target' }),
          history: pagedHistory('new-user-history'),
        });
      vi.mocked(fetchAdminAccessHistory)
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(newRequest.promise);
      await renderDetail();
      await nextHistoryPage(0);
      await renderDetail('new-target');
      await nextHistoryPage(0);
      expect(fetchAdminAccessHistory).toHaveBeenCalledTimes(2);

      await act(async () => {
        if (outcome === 'resolve')
          oldRequest.resolve(pagedHistory('stale-user-history', 2));
        else oldRequest.reject(new Error('old network error'));
      });
      expect(container.textContent).toContain('new-user-history');
      expect(container.textContent).not.toContain('stale-user-history');
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(
        [...container.querySelectorAll('button')]
          .filter((button) => button.textContent === '다음')
          .every((button) => button.disabled),
      ).toBe(true);

      await act(async () =>
        newRequest.resolve(pagedHistory('new-user-page-two', 2)),
      );
      expect(container.textContent).toContain('new-user-page-two');
    },
  );
});

afterEach(async () => {
  await root.unmount();
  container.remove();
});

describe('요청/로그인 이력 — 항목 렌더링과 독립 페이지네이션(total 기반, 잘림 문구 제거)', () => {
  it('역할 요청 항목이 없으면 안내 문구를 보여준다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).toContain('역할 요청 이력이 없습니다.');
    expect(html).toContain('로그인 이력이 없습니다.');
  });

  it('요청/로그인 이력 항목을 상태 배지와 함께 그린다', () => {
    const rejectedRequest: AdminAccessStaffAccessRequestHistoryItem = {
      id: 'req-1',
      status: 'REJECTED',
      rejectionReason: '자격 요건 미충족',
      decidedAt: '2026-07-29T00:00:00.000Z',
      decidedBy: 'reviewer',
      createdAt: '2026-07-28T00:00:00.000Z',
    };
    const failedLogout: AdminAccessLoginHistoryItem = {
      id: 'login-1',
      event: 'LOGOUT',
      provider: 'github',
      success: false,
      loginAt: '2026-07-30T00:00:00.000Z',
    };
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory({
            staffAccessRequests: historyPage({ items: [rejectedRequest] }),
            loginHistory: historyPage({ items: [failedLogout] }),
          }),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );

    expect(html).toContain('반려');
    expect(html).toContain('자격 요건 미충족');
    expect(html).toContain('reviewer');
    expect(html).toContain('로그아웃');
    expect(html).toContain('실패');
  });

  it('더 이상 "최근 N건만 표시합니다" 잘림 문구를 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory({
            staffAccessRequests: historyPage({ total: 50 }),
          }),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).not.toContain('만 표시합니다');
  });

  it('total로 페이지 수를 계산해 "n / m 페이지"를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory({
            staffAccessRequests: historyPage({ page: 1, limit: 20, total: 25 }),
          }),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).toContain('1 / 2 페이지');
  });

  it('1페이지에서는 "이전" 버튼이 비활성화된다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory({
            staffAccessRequests: historyPage({ page: 1, limit: 20, total: 25 }),
          }),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    const prevIndex = html.indexOf('이전');
    const disabledBefore = html.slice(Math.max(0, prevIndex - 60), prevIndex);
    expect(disabledBefore).toContain('disabled');
  });

  it('마지막 페이지에서는 "다음" 버튼이 비활성화된다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory({
            staffAccessRequests: historyPage({ page: 2, limit: 20, total: 25 }),
          }),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).toContain('2 / 2 페이지');
    const nextIndex = html.indexOf('다음');
    const disabledBefore = html.slice(Math.max(0, nextIndex - 60), nextIndex);
    expect(disabledBefore).toContain('disabled');
  });

  it('historyLoading이 켜지면 두 섹션의 이전/다음 버튼이 모두 비활성화된다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory({
            staffAccessRequests: historyPage({ page: 2, limit: 20, total: 60 }),
            loginHistory: historyPage({ page: 2, limit: 20, total: 60 }),
          }),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        historyLoading
      />,
    );
    const disabledCount = html.match(/disabled=""/g)?.length ?? 0;

    expect(disabledCount).toBeGreaterThanOrEqual(4);
  });

  it('"다음" 버튼 클릭은 onStaffAccessRequestPageChange/onLoginHistoryPageChange를 다음 페이지 번호로 호출한다', () => {
    const onStaffAccessRequestPageChange = vi.fn();
    const onLoginHistoryPageChange = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{
            kind: 'ready',
            detail: adminDetail(),
            history: adminHistory({
              staffAccessRequests: historyPage({
                page: 1,
                limit: 20,
                total: 40,
              }),
              loginHistory: historyPage({ page: 1, limit: 20, total: 40 }),
            }),
          }}
          onRetry={() => {}}
          mutation={adminMutation()}
          onStaffAccessRequestPageChange={onStaffAccessRequestPageChange}
          onLoginHistoryPageChange={onLoginHistoryPageChange}
        />,
      );
    });

    const nextButtons = Array.from(container.querySelectorAll('button')).filter(
      (button) => button.textContent === '다음',
    );
    expect(nextButtons).toHaveLength(2);

    act(() => {
      nextButtons[0].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onStaffAccessRequestPageChange).toHaveBeenCalledWith(2);

    act(() => {
      nextButtons[1].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onLoginHistoryPageChange).toHaveBeenCalledWith(2);
  });
});
