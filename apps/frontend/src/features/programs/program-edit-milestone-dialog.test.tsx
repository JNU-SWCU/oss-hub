// @vitest-environment happy-dom

import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  toMilestoneForm,
  type ProgramMilestoneForm,
} from './program-edit-flow';
import { ProgramEditMilestoneDialog } from './program-edit-milestone-dialog';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const form = toMilestoneForm({
  id: 'milestone-1',
  name: '기획서 제출',
  startAt: '2026-08-16T09:30:59.000Z',
  dueAt: '2026-08-20T09:30:59.000Z',
  submissionType: 'TEXT',
  instructions: '초안을 제출하세요.',
});
const passiveProps = {
  operationStartAt: '2026-08-01T09:00',
  operationEndAt: '2026-08-31T18:00',
  contextEvents: [],
  isBusy: false,
  returnFocusRef: { current: null },
  onCancel: vi.fn(),
  onFieldChange: vi.fn(),
  onSave: vi.fn(),
};

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

function pressEscape(target: EventTarget = document) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function waitForNextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function DialogHarness({
  startingForm,
  isBusy = false,
  withReturnFocus = true,
  onCancel,
}: {
  readonly startingForm: ProgramMilestoneForm;
  readonly isBusy?: boolean;
  readonly withReturnFocus?: boolean;
  readonly onCancel: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [currentForm, setCurrentForm] = useState(startingForm);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={returnFocusRef} type="button" onClick={() => setOpen(true)}>
        기획서 제출 수정
      </button>
      {open ? (
        <ProgramEditMilestoneDialog
          editor={{
            mode: 'edit',
            form: currentForm,
            initialForm: form,
            errors: {},
          }}
          operationStartAt="2026-08-01T09:00"
          operationEndAt="2026-08-31T18:00"
          contextEvents={[]}
          isBusy={isBusy}
          returnFocusRef={withReturnFocus ? returnFocusRef : undefined}
          onCancel={() => {
            onCancel();
            setCurrentForm(form);
            setOpen(false);
          }}
          onFieldChange={(field, value) =>
            setCurrentForm((current) => ({ ...current, [field]: value }))
          }
          onSave={vi.fn()}
        />
      ) : null}
    </>
  );
}

describe('ProgramEditMilestoneDialog', () => {
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

  it('uses the milestone name as the dialog title and keeps all fields populated', async () => {
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
        />,
      ),
    );
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('기획서 제출 수정');
    expect(
      (document.querySelector('#milestone-name') as HTMLInputElement).value,
    ).toBe('기획서 제출');
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-controls]')
        ?.click();
    });
    expect(
      document.querySelector<HTMLInputElement>('#milestone-start-at')?.value,
    ).not.toBe('');
    expect(
      document.querySelector<HTMLInputElement>('#milestone-due-at')?.value,
    ).not.toBe('');
  });

  it('keeps Korean instruction words intact on narrow dialog widths', async () => {
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
        />,
      ),
    );

    const instructions = document.querySelector('#milestone-instructions');
    expect(instructions?.classList.contains('break-keep')).toBe(true);
    expect(instructions?.classList.contains('whitespace-pre-wrap')).toBe(true);
    expect(instructions?.classList.contains('[overflow-wrap:anywhere]')).toBe(
      true,
    );
  });

  it('closes a clean editor with one Escape and returns focus to its exact origin', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(<DialogHarness startingForm={form} onCancel={onCancel} />),
    );
    const origin = getButton('기획서 제출 수정');
    let originFocused = false;
    origin.addEventListener('focus', () => {
      originFocused = true;
    });
    await act(async () => {
      pressEscape(document.activeElement ?? document);
      await waitForNextFrame();
    });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(originFocused).toBe(true);
  });

  it('keeps dirty data through alert Escape and continue-editing, then discards once and restores origin focus', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <DialogHarness
          startingForm={{ ...form, name: '변경된 기획서' }}
          onCancel={onCancel}
        />,
      ),
    );

    const nameInput =
      document.querySelector<HTMLInputElement>('#milestone-name');
    if (!nameInput) throw new TypeError('Milestone name input not found');
    nameInput.focus();
    await act(async () => {
      pressEscape(nameInput);
    });
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('변경사항을 취소할까요?');
    expect(document.body.textContent).toContain(
      '저장하지 않은 변경사항은 사라집니다.',
    );
    expect(getButton('변경사항 취소')).toBeTruthy();
    expect(document.body.textContent).not.toContain('폐기');
    expect(onCancel).not.toHaveBeenCalled();
    expect(nameInput.value).toBe('변경된 기획서');

    let editorFocused = false;
    nameInput.addEventListener('focus', () => {
      editorFocused = true;
    });
    await act(async () => {
      pressEscape(document.activeElement ?? document);
      await waitForNextFrame();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(nameInput.value).toBe('변경된 기획서');
    expect(editorFocused).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();

    nameInput.focus();
    await act(async () => pressEscape(document.activeElement ?? document));
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    editorFocused = false;
    await act(async () => {
      getButton('계속 편집').click();
      await waitForNextFrame();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(nameInput.value).toBe('변경된 기획서');
    expect(editorFocused).toBe(true);

    await act(async () => pressEscape(document.activeElement ?? document));
    const origin = getButton('기획서 제출 수정');
    let originFocused = false;
    origin.addEventListener('focus', () => {
      originFocused = true;
    });
    await act(async () => {
      getButton('변경사항 취소').click();
      await waitForNextFrame();
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(originFocused).toBe(true);

    await act(async () => getButton('기획서 제출 수정').click());
    expect(
      document.querySelector<HTMLInputElement>('#milestone-name')?.value,
    ).toBe(form.name);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('focuses the first invalid field inside the portaled dialog', async () => {
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
        />,
      ),
    );
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          editor={{
            mode: 'edit',
            form,
            initialForm: form,
            errors: { dueAt: '마감일을 확인해 주세요.' },
          }}
        />,
      ),
    );

    expect(document.activeElement).toBe(
      document.querySelector('#milestone-due-at'),
    );
  });

  it('ignores Escape and overlay close attempts while a save is in progress', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <DialogHarness
          startingForm={{ ...form, name: '변경' }}
          isBusy
          onCancel={onCancel}
        />,
      ),
    );
    await act(async () => {
      pressEscape(document.activeElement ?? document);
      const overlay = document.querySelector<HTMLElement>(
        '.fixed.inset-0.z-50',
      );
      overlay?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
      overlay?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, cancelable: true }),
      );
      overlay?.click();
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('변경사항을 취소할까요?');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('treats an exact revert as clean and does not double-close without a focus ref', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <DialogHarness
          startingForm={{ ...form }}
          withReturnFocus={false}
          onCancel={onCancel}
        />,
      ),
    );
    await act(async () => pressEscape(document.activeElement ?? document));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
