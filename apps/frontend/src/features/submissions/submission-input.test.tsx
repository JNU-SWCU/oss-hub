// @vitest-environment happy-dom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SubmissionInput } from './components/submission-input';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function FileInputHarness() {
  const [file, setFile] = useState<File | null>(null);

  return (
    <SubmissionInput
      submissionType="FILE"
      repositoryUrl={null}
      input={{ file, text: '', releaseUrl: '' }}
      errors={{}}
      file={file}
      fileError={null}
      onTextChange={() => {}}
      onReleaseUrlChange={() => {}}
      onFileChange={setFile}
    />
  );
}

describe('SubmissionInput native file selection', () => {
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

  it('선택 직후 native 값을 유지하고 명시적 취소에서만 비운다', async () => {
    await act(async () => root.render(<FileInputHarness />));
    const input = container.querySelector<HTMLInputElement>('#submission-file');
    if (input === null) throw new TypeError('파일 입력을 찾지 못했습니다.');

    const file = new File(['report'], 'final-report.hwp', {
      type: 'application/x-hwp',
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: { 0: file, length: 1, item: () => file },
    });
    Object.defineProperty(input, 'value', {
      configurable: true,
      writable: true,
      value: 'C:\\fakepath\\final-report.hwp',
    });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(input.value).toBe('C:\\fakepath\\final-report.hwp');
    expect(container.textContent).toContain('final-report.hwp');

    const cancel = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '선택 취소',
    );
    if (!(cancel instanceof HTMLButtonElement)) {
      throw new TypeError('선택 취소 버튼을 찾지 못했습니다.');
    }
    await act(async () => cancel.click());

    expect(input.value).toBe('');
    expect(container.textContent).not.toContain('final-report.hwp');
  });
});
