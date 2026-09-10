// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './dialog';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('Dialog primitive', () => {
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
    document.body.innerHTML = '';
  });

  it('renders an accessible modal dialog and closes on Escape', async () => {
    // Given: a controlled dialog is open.
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent aria-describedby="dialog-description">
            <DialogTitle>동의 확인</DialogTitle>
            <DialogDescription id="dialog-description">
              계속하려면 필수 동의를 확인합니다.
            </DialogDescription>
            <button type="button">확인</button>
          </DialogContent>
        </Dialog>,
      );
    });

    // When: the user inspects and dismisses the dialog with the keyboard.
    const dialog = document.body.querySelector('[role="dialog"]');
    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    // Then: Radix exposes the modal semantics and requests closure.
    expect(dialog).toBeInstanceOf(HTMLElement);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-describedby')).toBe('dialog-description');
    expect(document.activeElement).toBeInstanceOf(HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
