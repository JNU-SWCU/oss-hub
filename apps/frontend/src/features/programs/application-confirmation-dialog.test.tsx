// @vitest-environment happy-dom

import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationConfirmationDialog } from './application-confirmation-dialog';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function ApplicationConfirmationDialogHarness() {
  const [submitting, setSubmitting] = useState(false);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={returnFocusRef} type="button" disabled={submitting}>
        수정 내용 저장
      </button>
      <ApplicationConfirmationDialog
        kind="save"
        submitting={submitting}
        onClose={() => {}}
        onConfirm={() => setSubmitting(true)}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

describe('ApplicationConfirmationDialog', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleErrors: unknown[][];

  beforeEach(() => {
    consoleErrors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args);
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    // 이 파일은 테스트가 통과해도 act 경고를 남긴 적이 있다(QA27). 경고 자체도
    // 회귀 신호로 취급해야 같은 비동기 경계가 다시 흐려지지 않는다.
    expect(consoleErrors).toEqual([]);
  });

  it('Escape로 닫으면 실제 Radix AlertDialog가 원래 저장 버튼에 포커스를 돌려준다', async () => {
    await act(async () =>
      root.render(<ApplicationConfirmationDialogHarness />),
    );

    const cancelButton = getButton('돌아가서 확인');
    const returnButton = getButton('수정 내용 저장');
    const focusReturned = new Promise<void>((resolve) => {
      returnButton.addEventListener('focus', () => resolve(), { once: true });
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(cancelButton);

    await act(async () => {
      cancelButton.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await focusReturned;

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(returnButton);
  });

  it('돌아가서 확인을 클릭해 닫아도 원래 저장 버튼에 포커스를 돌려준다', async () => {
    // Given
    await act(async () =>
      root.render(<ApplicationConfirmationDialogHarness />),
    );
    const cancelButton = getButton('돌아가서 확인');
    const returnButton = getButton('수정 내용 저장');
    const focusReturned = new Promise<void>((resolve) => {
      returnButton.addEventListener('focus', () => resolve(), { once: true });
    });

    // When
    await act(async () => {
      cancelButton.click();
      await focusReturned;
    });

    // Then
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(returnButton);
  });
  it('확인 중에는 실제 AlertDialog를 열어 두고 중복 확정을 막는다', async () => {
    await act(async () =>
      root.render(<ApplicationConfirmationDialogHarness />),
    );

    const confirmButton = document
      .querySelector('[role="alertdialog"]')
      ?.querySelector<HTMLButtonElement>('button:last-child');
    if (!confirmButton) throw new TypeError('Confirm button not found');
    await act(async () => confirmButton.click());

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(getButton('처리 중…').disabled).toBe(true);
    expect(getButton('돌아가서 확인').disabled).toBe(true);
  });
});
