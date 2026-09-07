// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import { MilestoneDocumentSubmissionForm } from './milestone-document-submission-form';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});
let container: HTMLDivElement;
let root: Root;
const onSubmit = vi.fn().mockResolvedValue(false);

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSubmit.mockClear();
  await act(async () =>
    root.render(
      <MilestoneDocumentSubmissionForm
        documentName="계획서"
        documentId="document-1"
        fileUpload={milestoneDocumentUploadPolicy()}
        currentFileName="previous.pdf"
        isResubmission
        submitting={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function input(): HTMLInputElement {
  const value = container.querySelector('input[type="file"]');
  if (!(value instanceof HTMLInputElement))
    throw new TypeError('Missing picker');
  return value;
}
async function select(file: File) {
  const picker = input();
  Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
  await act(async () =>
    picker.dispatchEvent(new Event('change', { bubbles: true })),
  );
}
async function typeText(text: string) {
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new TypeError('Missing text');
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set?.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
function continueWithoutFile(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === '파일 없이 계속',
  );
  if (!button) throw new TypeError('Missing recovery action');
  return button;
}

it('keeps text and existing attachment visible while refusing an invalid selection', async () => {
  expect(container.querySelector('button[type="submit"]')?.textContent).toBe(
    '다시 제출',
  );
  await typeText('수정 내용');
  await select(new File(['bad'], 'wrong.exe'));
  expect(container.textContent).toContain('wrong.exe');
  expect(container.textContent).toContain('previous.pdf');
  expect(input().getAttribute('aria-invalid')).toBe('true');
  await submit();
  expect(onSubmit).not.toHaveBeenCalled();
  await act(async () => continueWithoutFile().click());
  expect(onSubmit).not.toHaveBeenCalled();
  expect(container.querySelector('textarea')?.value).toBe('수정 내용');
  await submit();
  expect(onSubmit).toHaveBeenCalledWith({ text: '수정 내용', file: null });
});

it('replaces a rejected file directly without clearing the text or submitting automatically', async () => {
  await typeText('수정 내용');
  await select(new File(['bad'], 'wrong.png'));
  const replacement = new File(['%PDF-1.4'], 'replacement.pdf');
  await select(replacement);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(onSubmit).not.toHaveBeenCalled();
  await submit();
  expect(onSubmit).toHaveBeenCalledWith({
    text: '수정 내용',
    file: replacement,
  });
  expect(container.querySelector('textarea')?.value).toBe('수정 내용');
});

it('still refuses an empty submission after continuing without a rejected oversized file', async () => {
  const file = new File(['bad'], 'too-large.pdf');
  Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 + 1 });
  await select(file);
  await act(async () => continueWithoutFile().click());
  await submit();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(container.querySelector('button[type="submit"]')).toHaveProperty(
    'disabled',
    true,
  );
});
