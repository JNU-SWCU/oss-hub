import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clickButton,
  findButton,
  typeRejectReason,
} from './admin-access-detail-post-decision-fixture';
import {
  adminDetail,
  adminHistory,
  adminMutation,
} from './admin-access-detail-test-fixture';
import { AdminAccessDetailContentForState } from './components/admin-access-detail-content';

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

function renderDialog(content: ReactNode): HTMLElement {
  act(() => root.render(content));
  const dialog = document.querySelector('[data-slot="dialog-shell"]');
  if (!(dialog instanceof HTMLElement)) {
    throw new TypeError('공용 확인 다이얼로그를 찾지 못했습니다.');
  }
  return dialog;
}

function rejectContent(
  overrides: Parameters<typeof adminMutation>[0] = {},
): ReactNode {
  return (
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
      mutation={adminMutation({ confirmAction: 'REJECT', ...overrides })}
    />
  );
}

function pressEscape(target: EventTarget) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

async function flushDelayedUnmount() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('요청/계정 상태 확인 다이얼로그', () => {
  it('SET_STATUS_DEACTIVATED는 "계정 비활성화" 다이얼로그를 destructive로 띄운다', () => {
    const dialog = renderDialog(
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
    expect(dialog.textContent).toContain('계정 비활성화');
    expect(dialog.textContent).toContain('octocat님의 계정을 비활성화합니다.');
    expect(dialog.textContent).toContain('비활성화 확정');
  });

  it('SET_STATUS_ACTIVE는 "계정 재활성화" 다이얼로그를 non-destructive로 띄운다', () => {
    const dialog = renderDialog(
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
    expect(dialog.textContent).toContain('계정 재활성화');
    expect(dialog.textContent).toContain('재활성화 확정');
  });

  it('APPROVE는 승인 확정 다이얼로그를 띄운다', () => {
    const dialog = renderDialog(
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
    expect(dialog.textContent).toContain('요청 승인');
    expect(dialog.textContent).toContain('승인 확정');
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

    const cancelButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === '취소',
    );
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
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
  it('confirmAction이 REJECT면 사유 입력란과 반려 확정 버튼을 가진 alertdialog를 그린다', () => {
    const dialog = renderDialog(rejectContent());

    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(
      document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
        ?.textContent,
    ).toBe('요청 반려');
    expect(dialog.textContent).toContain(
      'octocat님의 교직원 권한 요청을 반려합니다.',
    );
    expect(
      dialog.querySelector('label[for="admin-access-reject-reason"]')
        ?.textContent,
    ).toBe('반려 사유');
    expect(
      dialog.querySelector('textarea#admin-access-reject-reason'),
    ).not.toBeNull();
    expect(findButton(dialog, '반려 확정')).toBeDefined();
  });

  it('사유가 비어 있거나 공백뿐이면 반려 확정 버튼이 비활성화된다', () => {
    const dialog = renderDialog(rejectContent({ rejectReason: '' }));
    expect(findButton(dialog, '반려 확정')?.disabled).toBe(true);

    renderDialog(rejectContent({ rejectReason: '   ' }));
    expect(findButton(dialog, '반려 확정')?.disabled).toBe(true);

    renderDialog(rejectContent({ rejectReason: '소속 확인이 필요합니다.' }));
    expect(findButton(dialog, '반려 확정')?.disabled).toBe(false);
  });

  it('사유를 입력하면 onReasonChange에 입력값을 전달한다', () => {
    const onReasonChange = vi.fn();
    renderDialog(rejectContent({ onReasonChange }));

    act(() => typeRejectReason(document.body, '소속 확인이 필요합니다.'));

    expect(onReasonChange).toHaveBeenCalledWith('소속 확인이 필요합니다.');
  });

  it('취소 버튼은 onCancel을, 반려 확정 버튼은 onConfirm을 호출한다', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderDialog(
      rejectContent({
        rejectReason: '소속 확인이 필요합니다.',
        onCancel,
        onConfirm,
      }),
    );

    act(() => clickButton(document.body, '취소'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    act(() => clickButton(document.body, '반려 확정'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Escape를 누르면 onCancel을 호출한다', () => {
    const onCancel = vi.fn();
    const dialog = renderDialog(rejectContent({ onCancel }));

    pressEscape(dialog);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('반려 처리 중에는 버튼과 사유 입력란이 잠기고 Escape로도 닫히지 않는다', () => {
    const onCancel = vi.fn();
    const dialog = renderDialog(
      rejectContent({
        processingAction: 'REJECT',
        rejectReason: '소속 확인이 필요합니다.',
        onCancel,
      }),
    );

    pressEscape(dialog);

    expect(findButton(dialog, '취소')?.disabled).toBe(true);
    expect(findButton(dialog, '반려 확정')?.disabled).toBe(true);
    expect(
      dialog.querySelector<HTMLTextAreaElement>('#admin-access-reject-reason')
        ?.disabled,
    ).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('dialogError가 있으면 반려 다이얼로그 안에 에러를 그린다', () => {
    const dialog = renderDialog(
      rejectContent({ dialogError: '이미 처리된 요청입니다.' }),
    );

    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      '이미 처리된 요청입니다.',
    );
  });

  it('열리면 취소 버튼에 포커스를 두고 닫히면 반려를 누른 버튼으로 돌려준다', async () => {
    act(() => root.render(rejectContent({ confirmAction: null })));
    const opener = findButton(container, '반려');
    if (!opener) throw new TypeError('반려 버튼을 찾지 못했습니다.');
    opener.focus();

    const dialog = renderDialog(rejectContent());
    expect(document.activeElement).toBe(findButton(dialog, '취소'));

    act(() => root.render(rejectContent({ confirmAction: null })));
    await flushDelayedUnmount();

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
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
    const dialog = renderDialog(
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
    expect(dialog.textContent).toContain(
      '활성 관리자 계정을 최소 한 개 유지해야 합니다.',
    );
  });
});
