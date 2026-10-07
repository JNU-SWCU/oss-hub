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

function chooseRoleOption(id: string, label: string): void {
  const trigger = container.querySelector(`#${id}`);
  if (
    !(trigger instanceof HTMLButtonElement) ||
    trigger.getAttribute('role') !== 'combobox'
  ) {
    throw new TypeError(`드롭다운을 찾지 못했습니다: ${id}`);
  }

  act(() => {
    trigger.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
      }),
    );
    trigger.dispatchEvent(
      new PointerEvent('pointerup', {
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
      }),
    );
    trigger.click();
  });

  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const listboxId = trigger.getAttribute('aria-controls');
  const listbox = listboxId
    ? document.getElementById(listboxId)
    : document.querySelector<HTMLElement>(
        '[role="listbox"][data-state="open"]',
      );
  if (
    !listbox ||
    listbox.getAttribute('role') !== 'listbox' ||
    listbox.getAttribute('data-state') !== 'open'
  ) {
    throw new TypeError(`목록을 열지 못했습니다: ${id}`);
  }

  const option = Array.from(
    listbox.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!option) {
    throw new TypeError(`선택지를 찾지 못했습니다: ${label}`);
  }

  act(() => {
    option.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
      }),
    );
    option.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        clientX: 100,
        clientY: 100,
      }),
    );
    option.dispatchEvent(
      new PointerEvent('pointerup', {
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
      }),
    );
    option.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    option.click();
  });
}

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

    expect(html).not.toContain('프로필 수정');
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
  it('회원 유형을 교직원으로 고르면 SET_MEMBER_STAFF로 전달된다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{
            kind: 'ready',
            detail: adminDetail({
              role: 'STUDENT',
              memberKind: 'STUDENT',
              hasStaffAccess: true,
            }),
            history: adminHistory(),
          }}
          onRetry={() => {}}
          mutation={adminMutation({ onRequestAction })}
        />,
      );
    });

    chooseRoleOption('admin-member-kind-control', '교직원');
    expect(onRequestAction).toHaveBeenCalledWith('SET_MEMBER_STAFF');
  });
});
