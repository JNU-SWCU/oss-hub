import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminDetail,
  adminHistory,
  adminMutation,
} from './admin-access-detail-test-fixture';
import { AdminAccessDetailContentForState } from './components/admin-access-detail-content';
import type { AdminAccessMutationAction } from './admin-access-mutation-policy';
import type { CanonicalAdminAccessDetail } from './independent-authority-api';

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

function mountDialog(
  action: AdminAccessMutationAction,
  detailOverrides: Partial<CanonicalAdminAccessDetail> = {},
  mutationOverrides: {
    readonly processingAction?: AdminAccessMutationAction | null;
  } = {},
) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  act(() => {
    root.render(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({
            memberKind: 'STAFF',
            hasStaffAccess: true,
            hasAdminAccess: true,
            ...detailOverrides,
          }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation({
          confirmAction: action,
          processingAction: mutationOverrides.processingAction ?? null,
          onCancel,
          onConfirm,
        })}
      />,
    );
  });
  const dialog = document.body.querySelector('[role="dialog"]');
  if (!(dialog instanceof HTMLElement)) {
    throw new TypeError('확인 다이얼로그를 찾지 못했습니다.');
  }
  return { dialog, onCancel, onConfirm };
}

function confirm(dialog: HTMLElement): void {
  const buttons = Array.from(dialog.querySelectorAll('button'));
  const confirmButton = buttons.at(-1);
  if (!(confirmButton instanceof HTMLButtonElement)) {
    throw new TypeError('확정 버튼을 찾지 못했습니다.');
  }
  act(() => {
    confirmButton.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
  });
}

describe('registration reset confirmation', () => {
  it('confirms without collecting replacement profile data', () => {
    const { dialog, onConfirm } = mountDialog('RESET_MEMBER_KIND');
    expect(dialog.dataset.slot).toBe('dialog-shell');
    expect(dialog.querySelector('input')).toBeNull();
    confirm(dialog);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith();
    expect(
      dialog.querySelector('button:last-child')?.getAttribute('data-variant'),
    ).toBe('destructive');
  });
  it('cancels without changing the registration', () => {
    const { dialog, onCancel, onConfirm } = mountDialog('RESET_MEMBER_KIND');
    const cancel = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === '취소',
    );
    act(() => cancel?.click());
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('blocks submission and Escape while processing', () => {
    const { dialog, onCancel, onConfirm } = mountDialog(
      'RESET_MEMBER_KIND',
      {},
      { processingAction: 'RESET_MEMBER_KIND' },
    );
    expect(
      dialog.querySelector<HTMLButtonElement>('button:last-child')?.disabled,
    ).toBe(true);
    act(() => {
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
describe('관리자 접근 회수 확인', () => {
  it('관리자 접근 회수는 member fields 없이 confirm을 dispatch한다', () => {
    const { dialog, onConfirm } = mountDialog('REVOKE_ADMIN_ACCESS');
    confirm(dialog);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(
      dialog.querySelector('button:last-child')?.getAttribute('data-variant'),
    ).toBe('destructive');
  });
});
