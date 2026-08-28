// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toMilestoneForm } from './program-edit-flow';
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
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
          operationStartAt="2026-08-01T09:00"
          operationEndAt="2026-08-31T18:00"
          contextEvents={[]}
          isBusy={false}
          returnFocusRef={{ current: null }}
          onCancel={vi.fn()}
          onFieldChange={vi.fn()}
          onSave={vi.fn()}
        />,
      ),
    );
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('기획서 제출 수정');
    expect(
      (document.querySelector('#milestone-name') as HTMLInputElement).value,
    ).toBe('기획서 제출');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-controls]')?.click();
    });
    expect(
      document.querySelector<HTMLInputElement>('#milestone-start-at')?.value,
    ).not.toBe('');
    expect(
      document.querySelector<HTMLInputElement>('#milestone-due-at')?.value,
    ).not.toBe('');
  });

  it('requires discard confirmation only while the current form is dirty', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          editor={{
            mode: 'edit',
            form: { ...form, name: '변경' },
            initialForm: form,
            errors: {},
          }}
          operationStartAt="2026-08-01T09:00"
          operationEndAt="2026-08-31T18:00"
          contextEvents={[]}
          isBusy={false}
          returnFocusRef={{ current: null }}
          onCancel={onCancel}
          onFieldChange={vi.fn()}
          onSave={vi.fn()}
        />,
      ),
    );
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('변경사항을 폐기할까요?');
  });

  it('closes immediately without discard confirmation when the form is clean', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
          operationStartAt="2026-08-01T09:00"
          operationEndAt="2026-08-31T18:00"
          contextEvents={[]}
          isBusy={false}
          returnFocusRef={{ current: null }}
          onCancel={onCancel}
          onFieldChange={vi.fn()}
          onSave={vi.fn()}
        />,
      ),
    );
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[data-dialog-cancel]')
        ?.click();
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain('변경사항을 폐기할까요?');
  });

  it('focuses the first invalid field inside the portaled dialog', async () => {
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
          operationStartAt="2026-08-01T09:00"
          operationEndAt="2026-08-31T18:00"
          contextEvents={[]}
          isBusy={false}
          returnFocusRef={{ current: null }}
          onCancel={vi.fn()}
          onFieldChange={vi.fn()}
          onSave={vi.fn()}
        />,
      ),
    );
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          editor={{
            mode: 'edit',
            form,
            initialForm: form,
            errors: { dueAt: '마감일을 확인해 주세요.' },
          }}
          operationStartAt="2026-08-01T09:00"
          operationEndAt="2026-08-31T18:00"
          contextEvents={[]}
          isBusy={false}
          returnFocusRef={{ current: null }}
          onCancel={vi.fn()}
          onFieldChange={vi.fn()}
          onSave={vi.fn()}
        />,
      ),
    );

    expect(document.activeElement).toBe(
      document.querySelector('#milestone-due-at'),
    );
  });

  it('ignores close attempts while a save is in progress', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          editor={{
            mode: 'edit',
            form: { ...form, name: '변경' },
            initialForm: form,
            errors: {},
          }}
          operationStartAt="2026-08-01T09:00"
          operationEndAt="2026-08-31T18:00"
          contextEvents={[]}
          isBusy
          returnFocusRef={{ current: null }}
          onCancel={onCancel}
          onFieldChange={vi.fn()}
          onSave={vi.fn()}
        />,
      ),
    );
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('변경사항을 폐기할까요?');
  });
});
