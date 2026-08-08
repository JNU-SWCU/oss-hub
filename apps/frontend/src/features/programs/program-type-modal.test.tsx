// @vitest-environment happy-dom

import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramTypeModal } from './program-type-modal';
import { PROGRAM_TEMPLATE_DEFINITIONS } from './program-templates';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function Harness({ onCancel }: { readonly onCancel: () => void }) {
  const firstDefinition = PROGRAM_TEMPLATE_DEFINITIONS[0];
  if (firstDefinition === undefined) {
    throw new TypeError('프로그램 유형 fixture가 비어 있습니다.');
  }
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState(firstDefinition);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={returnFocusRef} type="button">
        유형 다시 선택
      </button>
      {open ? (
        <ProgramTypeModal
          definitions={PROGRAM_TEMPLATE_DEFINITIONS}
          selected={selected}
          onSelect={setSelected}
          onContinue={() => setOpen(false)}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
          returnFocusRef={returnFocusRef}
        />
      ) : null}
    </>
  );
}

describe('ProgramTypeModal accessibility', () => {
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

  it('열리면 초점을 창 안으로 옮기고 Escape로 닫는다', async () => {
    const onCancel = vi.fn();
    await act(async () => root.render(<Harness onCancel={onCancel} />));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe('유형 다시 선택');
  });

  it('좁은 화면에서도 창 전체를 세로 스크롤할 수 있다', async () => {
    await act(async () => root.render(<Harness onCancel={vi.fn()} />));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(dialog?.className).toContain('overflow-y-auto');
  });

  it('마지막 동작에서 Tab을 누르면 첫 동작으로, Shift+Tab은 다시 마지막으로 순환한다', async () => {
    await act(async () => root.render(<Harness onCancel={vi.fn()} />));

    const buttons = [...document.querySelectorAll('button')];
    const close = buttons.find((button) => button.textContent === '닫기');
    const continueButton = buttons.find(
      (button) => button.textContent === '이 유형으로 계속',
    );
    if (!close || !continueButton) {
      throw new TypeError('대화상자 처음/마지막 동작을 찾지 못했습니다.');
    }

    continueButton.focus();
    await act(async () => {
      continueButton.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(close);

    await act(async () => {
      close.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(continueButton);
  });
});
