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
  const [open, setOpen] = useState(true);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={returnFocusRef} type="button">
        수정 내용 저장
      </button>
      {open ? (
        <ApplicationConfirmationDialog
          kind="save"
          submitting={false}
          onClose={() => setOpen(false)}
          onConfirm={vi.fn()}
          returnFocusRef={returnFocusRef}
        />
      ) : null}
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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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
});
