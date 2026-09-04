// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
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
          fileUpload={milestoneDocumentUploadPolicy()}
          currentFileName={null}
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
          fileUpload={milestoneDocumentUploadPolicy()}
          currentFileName={null}
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
          fileUpload={milestoneDocumentUploadPolicy()}
          currentFileName={null}
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
  /*
   * #1107 — 파일을 고르는 시점에 걸러지지 않아, 상한을 넘은 파일이 그대로 전송되고 학생
   * 화면에는 「API 오류 응답이 ProblemDetail 형식이 아닙니다.」가 떴다. 상한과 허용 형식은
   * 실패한 뒤가 아니라 고르기 전에 읽을 수 있어야 한다.
   */
  describe('파일을 고르기 전과 고른 직후', () => {
    async function renderForm(onSubmit = vi.fn().mockResolvedValue(true)) {
      await act(async () => {
        root.render(
          <MilestoneDocumentSubmissionForm
            documentName="프로젝트 계획"
            documentId="document-1"
            fileUpload={milestoneDocumentUploadPolicy()}
            submitting={false}
            onCancel={vi.fn()}
            onSubmit={onSubmit}
          />,
        );
      });
      return onSubmit;
    }

    function fileInput(): HTMLInputElement {
      const element = container.querySelector('input[type="file"]');
      if (!(element instanceof HTMLInputElement))
        throw new TypeError('Missing file input.');
      return element;
    }

    async function select(name: string, size: number) {
      const input = fileInput();
      const candidate = new File(['synthetic'], name);
      Object.defineProperty(candidate, 'size', {
        configurable: true,
        value: size,
      });
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [candidate],
      });
      await act(async () =>
        input.dispatchEvent(new Event('change', { bubbles: true })),
      );
    }

    it('고르기 전에 허용 형식과 상한을 보여 주고 고를 수 있는 형식을 제한한다', async () => {
      await renderForm();

      expect(container.textContent).toContain(
        'PDF, HWP, JPG, PNG, ZIP · 최대 5 MB',
      );
      expect(fileInput().getAttribute('accept')).toBe(
        '.pdf,.hwp,.jpg,.jpeg,.png,.zip',
      );
    });

    it('상한을 넘은 파일은 받아 두지 않고 사유를 말한다', async () => {
      const onSubmit = await renderForm();
      await select('계획서.pdf', 5 * 1024 * 1024 + 1);

      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toBe('파일은 5 MB 이하여야 합니다.');
      expect(alert?.textContent).not.toContain('ProblemDetail');
      // 받아 두면 「제출」이 눌리고, 그 요청은 반드시 실패한다.
      expect(container.textContent).not.toContain('계획서.pdf');
      const submit = [...container.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '제출',
      );
      expect(submit).toHaveProperty('disabled', true);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('허용 형식 밖의 파일도 보내기 전에 걸러진다', async () => {
      await renderForm();
      await select('설치.exe', 10);

      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'PDF, HWP, JPG, PNG, ZIP 파일만 선택할 수 있습니다.',
      );
      expect(container.textContent).not.toContain('설치.exe');
    });

    it('걸린 뒤 제대로 된 파일을 고르면 사유가 사라지고 제출할 수 있다', async () => {
      const onSubmit = await renderForm();
      await select('설치.exe', 10);
      await select('계획서.pdf', 1024);

      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).toContain('계획서.pdf');
      const submit = [...container.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '제출',
      );
      expect(submit).toHaveProperty('disabled', false);
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it('지금 붙어 있는 첨부가 있으면 그 이름과 함께 이번 제출에서 빠진다고 알린다', async () => {
    await act(async () => {
      root.render(
        <MilestoneDocumentSubmissionForm
          documentName="프로젝트 계획"
          documentId="document-1"
          fileUpload={milestoneDocumentUploadPolicy()}
          currentFileName="1차_계획서.pdf"
          submitting={false}
          onCancel={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(true)}
        />,
      );
    });

    expect(container.textContent).toContain('기존 제출 파일');
    expect(container.textContent).toContain('1차_계획서.pdf');
    expect(container.textContent).toContain('이번 제출에서 빠집니다');
  });

  it('새 파일을 고르면 빠진다는 경고를 거둔다', async () => {
    await act(async () => {
      root.render(
        <MilestoneDocumentSubmissionForm
          documentName="프로젝트 계획"
          documentId="document-1"
          fileUpload={milestoneDocumentUploadPolicy()}
          currentFileName="1차_계획서.pdf"
          submitting={false}
          onCancel={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(true)}
        />,
      );
    });
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement))
      throw new TypeError('Missing file input.');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        new File(['synthetic'], '2차_계획서.pdf', { type: 'application/pdf' }),
      ],
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true })),
    );

    expect(container.textContent).toContain('기존 제출 파일');
    expect(container.textContent).not.toContain('이번 제출에서 빠집니다');
  });

  it('붙어 있는 첨부가 없으면 사라질 파일이 없으므로 경고하지 않는다', async () => {
    await act(async () => {
      root.render(
        <MilestoneDocumentSubmissionForm
          documentName="프로젝트 계획"
          documentId="document-1"
          fileUpload={milestoneDocumentUploadPolicy()}
          currentFileName={null}
          submitting={false}
          onCancel={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(true)}
        />,
      );
    });

    expect(container.textContent).not.toContain('기존 제출 파일');
    expect(container.textContent).not.toContain('이번 제출에서 빠집니다');
  });
});
