// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MilestoneDocumentSubmissionForm } from './milestone-document-submission-form';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('MilestoneDocumentSubmissionForm', () => {
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

  it('내용과 파일이 모두 비어 있으면 제출을 막는다', async () => {
    await act(async () => {
      root.render(
        <MilestoneDocumentSubmissionForm
          documentName="프로젝트 계획"
          documentId="document-1"
          submitting={false}
          onCancel={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(true)}
        />,
      );
    });

    const submit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '제출',
    );
    expect(submit).toBeInstanceOf(HTMLButtonElement);
    expect(submit).toHaveProperty('disabled', true);
  });

  it('내용만 입력해도 제출할 수 있다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    await act(async () => {
      root.render(
        <MilestoneDocumentSubmissionForm
          documentName="프로젝트 계획"
          documentId="document-1"
          submitting={false}
          onCancel={vi.fn()}
          onSubmit={onSubmit}
        />,
      );
    });
    const textarea = container.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement))
      throw new TypeError('Missing textarea.');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(textarea, '  계획 설명  ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = container.querySelector('form');
    await act(async () => {
      form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmit).toHaveBeenCalledWith({ text: '계획 설명', file: null });
  });

  it('공백 없는 긴 파일명도 모바일 카드 너비 안에서 줄바꿈한다', async () => {
    await act(async () => {
      root.render(
        <MilestoneDocumentSubmissionForm
          documentName="프로젝트 계획"
          documentId="document-1"
          submitting={false}
          onCancel={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(true)}
        />,
      );
    });
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement))
      throw new TypeError('Missing file input.');
    const name = `${'아주긴파일이름'.repeat(20)}.pdf`;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['synthetic'], name, { type: 'application/pdf' })],
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true })),
    );

    const label = container.querySelector(`[title="${name}"]`);
    expect(label?.className).toContain('break-all');
    expect(label?.className).toContain('[overflow-wrap:anywhere]');
    expect(label?.parentElement?.className).toContain('min-w-0');
  });
});
