// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MilestoneDocumentResubmissionDialog } from './milestone-document-resubmission-dialog';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

it.each(['previous.pdf', null])(
  'uses the one final confirmation and warns only for a removed attachment (%s)',
  async (removedFileName) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    try {
      await act(async () =>
        root.render(
          <MilestoneDocumentResubmissionDialog
            documentName="계획서"
            resubmissionDueAt="2099-12-31T00:00:00.000Z"
            removedFileName={removedFileName}
            submitting={false}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />,
        ),
      );
      expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
      const dialog = document.querySelector('[role="alertdialog"]');
      expect(dialog?.textContent?.includes('최신 제출본에서 빠집니다')).toBe(
        removedFileName !== null,
      );
      if (removedFileName !== null)
        expect(dialog?.textContent).toContain(removedFileName);
      expect(onConfirm).not.toHaveBeenCalled();
      const confirm = [...document.querySelectorAll('button')].find(
        (button) => button.textContent === '제출 확정',
      );
      if (!confirm) throw new TypeError('Missing final confirmation');
      await act(async () => confirm.click());
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
