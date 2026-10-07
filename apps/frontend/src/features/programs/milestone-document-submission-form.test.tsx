import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import { checkMilestoneDocumentFile } from './milestone-document-api';
import { MilestoneDocumentSubmissionForm } from './milestone-document-submission-form';

vi.mock('./milestone-document-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./milestone-document-api')>()),
  checkMilestoneDocumentFile: vi.fn(),
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('MilestoneDocumentSubmissionForm', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(checkMilestoneDocumentFile).mockReset();
    vi.mocked(checkMilestoneDocumentFile).mockResolvedValue(undefined);
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

  describe('파일을 고르기 전과 고른 직후', () => {
    async function renderForm(onSubmit = vi.fn().mockResolvedValue(true)) {
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

      expect(container.textContent).toContain('PDF, HWP, ZIP · 최대 5 MB');
      expect(fileInput().getAttribute('accept')).toBe('.pdf,.hwp,.zip');
    });

    it('상한을 넘은 파일은 받아 두지 않고 사유를 말한다', async () => {
      const onSubmit = await renderForm();
      await select('계획서.pdf', 5 * 1024 * 1024 + 1);

      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toBe('파일은 5 MB 이하여야 합니다.');
      expect(alert?.textContent).not.toContain('ProblemDetail');

      expect(container.textContent).toContain('계획서.pdf');
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
        'PDF, HWP, ZIP 파일만 선택할 수 있습니다.',
      );
      expect(container.textContent).toContain('설치.exe');
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

  describe('ZIP을 고른 즉시 서버 판정', () => {
    const lockedDetail =
      '비밀번호가 걸린 압축 파일은 제출할 수 없습니다. 비밀번호 없이 다시 압축해 주세요.';

    function problem(code: string, detail: string) {
      return new ApiError({
        type: 'about:blank',
        title: code,
        status: 422,
        detail,
        instance: '/synthetic/milestone-document-files/checks',
        code,
      });
    }

    async function renderForm() {
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
      return onSubmit;
    }

    async function pick(file: File) {
      const input = container.querySelector('input[type="file"]');
      if (!(input instanceof HTMLInputElement))
        throw new TypeError('Missing file input.');
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file],
      });
      await act(async () =>
        input.dispatchEvent(new Event('change', { bubbles: true })),
      );
      return input;
    }

    function submitButton() {
      return [...container.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '제출',
      );
    }

    it('기다리는 동안 대기를, 거절이면 서버 문장을 파일 입력 아래에 세우고 제출은 막지 않는다', async () => {
      let rejectCheck: (reason: unknown) => void = () => undefined;
      vi.mocked(checkMilestoneDocumentFile).mockReturnValueOnce(
        new Promise<void>((_resolve, reject) => {
          rejectCheck = reject;
        }),
      );
      const onSubmit = await renderForm();

      const input = await pick(
        new File(['PK'], 'locked.zip', { type: 'application/zip' }),
      );

      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        '파일 확인 중…',
      );

      await act(async () => rejectCheck(problem('MSD_040', lockedDetail)));

      const error = container.querySelector(
        '#document-1-submission-file-error',
      );
      expect(error?.textContent).toBe(lockedDetail);
      expect(error?.getAttribute('role')).toBe('alert');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toContain(
        'document-1-submission-file-error',
      );
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(submitButton()).toHaveProperty('disabled', false);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('다른 파일을 고르면 지난 판정 문장을 지우고, ZIP이 아니면 판정을 묻지 않는다', async () => {
      vi.mocked(checkMilestoneDocumentFile).mockRejectedValueOnce(
        problem('MSD_040', lockedDetail),
      );
      await renderForm();
      await pick(new File(['PK'], 'locked.zip', { type: 'application/zip' }));
      expect(container.textContent).toContain(lockedDetail);

      await pick(new File(['%PDF'], '계획서.pdf', { type: 'application/pdf' }));

      expect(container.textContent).not.toContain(lockedDetail);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(checkMilestoneDocumentFile).toHaveBeenCalledTimes(1);
    });

    it('판정 요청이 판정이 아닌 이유로 실패하면 아무 말도 붙이지 않는다', async () => {
      vi.mocked(checkMilestoneDocumentFile).mockRejectedValueOnce(
        problem('AUTH_001', '로그인이 필요합니다.'),
      );
      await renderForm();

      await pick(new File(['PK'], 'bundle.zip', { type: 'application/zip' }));

      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(submitButton()).toHaveProperty('disabled', false);
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

  it('걸린 파일과 빠질 첨부를 동시에 안고도 두 안내를 모두 가리킨다', async () => {
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
    const oversized = new File(['synthetic'], '계획서.pdf');
    Object.defineProperty(oversized, 'size', {
      configurable: true,
      value: 5 * 1024 * 1024 + 1,
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [oversized],
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true })),
    );

    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(
      ' ',
    );
    expect(describedBy).toContain('document-1-submission-current-file');
    expect(describedBy).toContain('document-1-submission-file-error');
    for (const id of describedBy) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }

    expect(container.textContent).toContain('이번 제출에서 빠집니다');
    expect(container.textContent).toContain('파일은 5 MB 이하여야 합니다.');
  });
});
