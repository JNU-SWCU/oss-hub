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

describe('요청/계정 상태 확인 다이얼로그', () => {
  it('SET_STATUS_DEACTIVATED는 "계정 비활성화" 다이얼로그를 destructive로 띄운다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({ accountStatus: 'ACTIVE' }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation({
          confirmAction: 'SET_STATUS_DEACTIVATED',
        })}
      />,
    );
    expect(html).toContain('계정 비활성화');
    expect(html).toContain('octocat님의 계정을 비활성화합니다.');
    expect(html).toContain('비활성화 확정');
  });

  it('SET_STATUS_ACTIVE는 "계정 재활성화" 다이얼로그를 non-destructive로 띄운다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({ accountStatus: 'DEACTIVATED' }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation({
          confirmAction: 'SET_STATUS_ACTIVE',
        })}
      />,
    );
    expect(html).toContain('계정 재활성화');
    expect(html).toContain('재활성화 확정');
  });

  it('APPROVE는 승인 확정 다이얼로그를 띄운다', () => {
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
        mutation={adminMutation({
          confirmAction: 'APPROVE',
        })}
      />,
    );
    expect(html).toContain('요청 승인');
    expect(html).toContain('승인 확정');
  });

  it('다이얼로그의 취소 버튼은 mutation.onCancel을, 확정 버튼은 mutation.onConfirm을 호출한다', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{
            kind: 'ready',
            detail: adminDetail(),
            history: adminHistory(),
          }}
          onRetry={() => {}}
          mutation={adminMutation({
            confirmAction: 'SET_STATUS_DEACTIVATED',
            onCancel,
            onConfirm,
          })}
        />,
      );
    });

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '취소',
    );
    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '비활성화 확정',
    );
    act(() => {
      cancelButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => {
      confirmButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('반려 다이얼로그 — REJECT 액션에서만 뜨는 사유 입력형 (변경 없음)', () => {
  it('confirmAction이 REJECT면 사유 입력란과 반려 확정 버튼을 그린다', () => {
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
        mutation={adminMutation({ confirmAction: 'REJECT' })}
      />,
    );
    expect(html).toContain('요청 반려');
    expect(html).toContain('거절 사유');
    expect(html).toContain('반려 확정');
  });

  it('사유가 비어 있으면 반려 확정 버튼이 비활성화된다', () => {
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
        mutation={adminMutation({ confirmAction: 'REJECT', rejectReason: '' })}
      />,
    );
    const confirmIndex = html.indexOf('반려 확정');
    const before = html.slice(Math.max(0, confirmIndex - 200), confirmIndex);
    expect(before).toContain('disabled');
  });
});

describe('배너 — 충돌 알림·성공 메시지·다이얼로그 에러 (로직 변경 없음)', () => {
  it('conflictNotice가 있으면 CAS 충돌 안내를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation({
          conflictNotice: '다른 처리자가 먼저 변경했습니다.',
        })}
      />,
    );
    expect(html).toContain('접근 상태가 변경되었습니다');
    expect(html).toContain('다른 처리자가 먼저 변경했습니다.');
  });

  it('successMessage가 있으면 상태 배너로 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation({
          successMessage: 'octocat님에 대한 계정 비활성화 처리를 완료했습니다.',
        })}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain(
      'octocat님에 대한 계정 비활성화 처리를 완료했습니다.',
    );
  });

  it('dialogError가 있으면 열려 있는 다이얼로그 안에 에러를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail(),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation({
          confirmAction: 'SET_STATUS_DEACTIVATED',
          dialogError: '활성 관리자 계정을 최소 한 개 유지해야 합니다.',
        })}
      />,
    );
    expect(html).toContain('활성 관리자 계정을 최소 한 개 유지해야 합니다.');
  });
});
