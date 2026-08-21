// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminAccessLoginHistoryItem,
  AdminAccessRoleRequestHistoryItem,
} from './admin-access-api';
import {
  adminDetail,
  adminHistory,
  adminMutation,
  historyPage,
} from './admin-access-detail-test-fixture';
import { AdminAccessDetailContentForState } from './components/admin-access-detail-view';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
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
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory({
            roleRequests: historyPage({
              items: [
                {
                  id: 'req-1',
                  status: 'REJECTED',
                  rejectionReason: '자격 요건 미충족',
                  decidedAt: '2026-07-29T00:00:00.000Z',
                  decidedBy: 'reviewer',
                  createdAt: '2026-07-28T00:00:00.000Z',
                },
              ],
            }),
            loginHistory: historyPage({
              items: [
                {
                  id: 'login-1',
                  event: 'LOGOUT',
                  provider: 'github',
                  success: false,
                  loginAt: '2026-07-30T00:00:00.000Z',
                },
              ],
            }),
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
            roleRequests: historyPage({ total: 50 }),
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
            roleRequests: historyPage({ page: 1, limit: 20, total: 25 }),
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
            roleRequests: historyPage({ page: 1, limit: 20, total: 25 }),
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
            roleRequests: historyPage({ page: 2, limit: 20, total: 25 }),
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
            roleRequests: historyPage({ page: 2, limit: 20, total: 60 }),
            loginHistory: historyPage({ page: 2, limit: 20, total: 60 }),
          }),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        historyLoading
      />,
    );
    const disabledCount = html.match(/disabled=""/g)?.length ?? 0;
    // 이력 섹션 두 곳 각각 이전/다음 2개씩 = 4개.
    expect(disabledCount).toBeGreaterThanOrEqual(4);
  });

  it('"다음" 버튼 클릭은 onRoleRequestPageChange/onLoginHistoryPageChange를 다음 페이지 번호로 호출한다', () => {
    const onRoleRequestPageChange = vi.fn();
    const onLoginHistoryPageChange = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{
            kind: 'ready',
            detail: adminDetail(),
            history: adminHistory({
              roleRequests: historyPage({ page: 1, limit: 20, total: 40 }),
              loginHistory: historyPage({ page: 1, limit: 20, total: 40 }),
            }),
          }}
          onRetry={() => {}}
          mutation={adminMutation()}
          onRoleRequestPageChange={onRoleRequestPageChange}
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
    expect(onRoleRequestPageChange).toHaveBeenCalledWith(2);

    act(() => {
      nextButtons[1].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onLoginHistoryPageChange).toHaveBeenCalledWith(2);
  });
});
