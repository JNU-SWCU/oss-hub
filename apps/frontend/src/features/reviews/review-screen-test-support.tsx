import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect } from 'vitest';

import { SubmissionReviewScreen } from './components/submission-review-screen';
import type { ReviewContext } from './types';

export function context(
  number = 1,
  submissionId = 'submission-synthetic',
): ReviewContext {
  return {
    submissionId,
    application: {
      id: 'application-synthetic',
      applicationMode: 'PERSONAL',
      displayName: '합성 신청자',
    },
    milestone: { id: 'milestone-final', name: '최종 제출' },
    currentRevision: {
      number,
      content: { type: 'TEXT', text: `제출 글 ${number}` },
      comment: `제출 의견 ${number}`,
      submittedAt: `2026-09-0${number}T01:00:00.000Z`,
      files: [],
      review: null,
    },
    history: [],
    repository: null,
  };
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('promise not initialized');
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error('promise not initialized');
  };
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function reviewScreen() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  return {
    container,
    render: (submissionId = 'submission-synthetic') =>
      act(async () => {
        root.render(<SubmissionReviewScreen submissionId={submissionId} />);
      }),
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
    button: (text: string) => {
      const button = [...container.querySelectorAll('button')].find(
        (item) => item.textContent === text,
      );
      if (!button) throw new Error(`button missing: ${text}`);
      return button;
    },
    radio: (value = 'APPROVED') => {
      const input = container.querySelector<HTMLInputElement>(
        `input[value="${value}"]`,
      );
      if (!input) throw new Error(`radio missing: ${value}`);
      return input;
    },
    comment: () => {
      const textarea = container.querySelector('textarea');
      if (!textarea) throw new Error('comment missing');
      return textarea;
    },
    writeComment: async (value: string) => {
      const textarea = container.querySelector('textarea');
      expect(textarea).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set?.call(textarea, value);
        textarea?.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  };
}
