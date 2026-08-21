// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminDetail,
  adminHistory,
  adminMutation,
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

describe('대기 중인 요청 결정 카드 — 접근 변경 카드 위에 조건부로 뜬다', () => {
  it('대기 요청이 없으면 결정 카드를 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({ pendingRequest: null }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).not.toContain('대기 중인 요청');
  });

  it('대기 요청이 있으면 결정 카드와 접근 변경 컨트롤을 함께 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({
            pendingRequest: {
              id: 'req-1',
              status: 'PENDING',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
      />,
    );
    expect(html).toContain('대기 중인 요청');
    expect(html).toContain('신청됨');
    expect(html).toContain('대기 중인 요청을 먼저 처리해 주세요.');
  });

  it('가입 신청 상세는 승인·반려만 두고 역할 변경 컨트롤은 숨긴다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({
            pendingRequest: {
              id: 'req-1',
              status: 'PENDING',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation()}
        workspace="queue"
      />,
    );
    expect(html).toContain('대기 중인 요청');
    expect(html).not.toContain('접근 변경');
    expect(html).not.toContain('>수정<');
  });

  it('결정 카드의 승인 버튼 클릭은 mutation.onRequestAction을 APPROVE로 호출한다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{
            kind: 'ready',
            detail: adminDetail({
              pendingRequest: {
                id: 'req-1',
                status: 'PENDING',
                createdAt: '2026-07-30T00:00:00.000Z',
              },
            }),
            history: adminHistory(),
          }}
          onRetry={() => {}}
          mutation={adminMutation({ onRequestAction })}
        />,
      );
    });

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '승인',
    );
    act(() => {
      approveButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onRequestAction).toHaveBeenCalledWith('APPROVE');
  });
});

describe('독립 접근 컨트롤 통합', () => {
  it('교직원 허용 버튼은 GRANT_STAFF_ACCESS로 전달된다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{
            kind: 'ready',
            detail: adminDetail({
              role: 'STUDENT',
              memberKind: 'STUDENT',
              hasStaffAccess: false,
            }),
            history: adminHistory(),
          }}
          onRetry={() => {}}
          mutation={adminMutation({ onRequestAction })}
        />,
      );
    });

    const staffGroup = container.querySelector(
      '[aria-labelledby="admin-staff-access-control-label"]',
    );
    const staffButton = Array.from(
      staffGroup?.querySelectorAll('button[role="radio"]') ?? [],
    ).find((button) => button.textContent?.endsWith('허용'));
    act(() => {
      staffButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onRequestAction).toHaveBeenCalledWith('GRANT_STAFF_ACCESS');
  });
});
