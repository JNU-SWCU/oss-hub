// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmissionDialog } from './components/submission-dialog';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('SubmissionDialog typography', () => {
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

  it('좁은 화면에서 설명의 한글 어절을 중간에 나누지 않는다', async () => {
    await act(async () =>
      root.render(
        <SubmissionDialog
          title="제출 내용"
          description="설명"
          onClose={vi.fn()}
          returnFocusId="submission-trigger"
        >
          <div />
        </SubmissionDialog>,
      ),
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const descriptionId = dialog?.getAttribute('aria-describedby');
    const description =
      descriptionId === null || descriptionId === undefined
        ? null
        : document.getElementById(descriptionId);

    expect(description?.classList.contains('break-keep')).toBe(true);
  });
});
