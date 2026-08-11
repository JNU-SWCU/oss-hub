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
      input={{ file, text: '' }}
      errors={{}}
      file={file}
      fileError={null}
      onTextChange={() => {}}
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

  it('파일 오류를 `errors.file`로만 받아도 화면에 띄운다', async () => {
    // Given: 파일 오류를 담는 자리가 둘인데 뒤의 것만 채운 호출부.
    await act(async () =>
      root.render(
        <SubmissionInput
          submissionType="FILE"
          input={{ file: null, text: '' }}
          errors={{ file: '제출할 파일을 선택해 주세요.' }}
          file={null}
          fileError={null}
          onTextChange={() => {}}
          onFileChange={() => {}}
        />,
      ),
    );

    // Then: 말없이 넘어가지 않고 그 문구가 보인다.
    const error = container.querySelector('#submission-file-error');
    expect(error?.textContent).toBe('제출할 파일을 선택해 주세요.');
  });

  it('좁은 화면에서 제출 안내의 한글 어절을 중간에 나누지 않는다', async () => {
    await act(async () => root.render(<FileInputHarness />));

    const steps = container.querySelector<HTMLElement>(
      '[data-testid="file-submission-steps"]',
    );
    const instruction = steps?.querySelector<HTMLElement>(
      ':scope > div:last-child p:last-child',
    );

    expect(instruction?.classList.contains('break-keep')).toBe(true);
  });
});
