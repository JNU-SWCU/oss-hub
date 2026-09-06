// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import type {
  MilestoneDocument,
  MilestoneDocumentList,
} from './milestone-document-api';
import {
  LocalMilestoneDocumentsEditor,
  ReadOnlyMilestoneDocuments,
} from './milestone-document-editor';
import { toLocalMilestoneDocuments } from './milestone-document-editor-flow';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const listMilestoneDocumentsMock = vi.hoisted(() => vi.fn());
vi.mock('./milestone-document-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./milestone-document-api')>()),
  listMilestoneDocuments: listMilestoneDocumentsMock,
}));

const documentFixture: MilestoneDocument = {
  id: 'document-1',
  milestoneId: 'milestone-1',
  name: '계획서',
  required: true,
  sortOrder: 1,
  hasTemplateFile: true,
  templateFileName: 'plan.pdf',
};

function list(documents: readonly MilestoneDocument[]): MilestoneDocumentList {
  return {
    documents,
    fileUpload: {
      maxBytes: 5242880,
      maxLabel: '5 MiB',
      accept: '.pdf',
      formatLabel: 'PDF',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('ReadOnlyMilestoneDocuments', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    listMilestoneDocumentsMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('loads documents and retries an initial failure', async () => {
    listMilestoneDocumentsMock
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(list([documentFixture]));
    await act(async () => {
      root.render(<ReadOnlyMilestoneDocuments milestoneId="milestone-1" />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain('불러오지 못했습니다');
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '다시 시도')
        ?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('계획서 · 필수');
    const download = container.querySelector('a');
    expect(download?.textContent).toBe('plan.pdf');
    expect(download?.getAttribute('href')).toBe(
      apiPath('milestones/milestone-1/documents/document-1/template'),
    );
  });

  it('ignores late success and failure after canonical documents arrive', async () => {
    const pending = deferred<MilestoneDocumentList>();
    listMilestoneDocumentsMock.mockReturnValue(pending.promise);
    await act(async () => {
      root.render(<ReadOnlyMilestoneDocuments milestoneId="milestone-1" />);
    });
    await act(async () => {
      root.render(
        <ReadOnlyMilestoneDocuments
          milestoneId="milestone-1"
          canonicalDocuments={[
            {
              id: 'canonical',
              name: '저장된 결과물',
              required: false,
              sortOrder: 1,
              templateFileName: null,
            },
          ]}
        />,
      );
      pending.resolve(list([documentFixture]));
      await Promise.resolve();
    });
    expect(container.textContent).toContain('저장된 결과물 · 선택');
    expect(container.textContent).not.toContain('계획서');
  });

  it('shows actionable empty state for a canonical empty list', async () => {
    await act(async () => {
      root.render(
        <ReadOnlyMilestoneDocuments
          milestoneId="milestone-1"
          canonicalDocuments={[]}
        />,
      );
    });
    expect(container.textContent).toContain('제출 항목이 없습니다.');
  });
});

describe('LocalMilestoneDocumentsEditor', () => {
  it('rejects invalid selection and cancels a valid local replacement without API writes', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let documents = toLocalMilestoneDocuments([documentFixture]);
    const onChange = vi.fn((next: typeof documents) => {
      documents = next;
      render();
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network request'));
    function render() {
      root.render(
        <LocalMilestoneDocumentsEditor
          milestoneId="milestone-1"
          documents={documents}
          fileUpload={list([]).fileUpload}
          onChange={onChange}
        />,
      );
    }
    try {
      await act(async () => render());
      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]');
      if (input === null) throw new TypeError('Missing local file input.');
      const invalid = new File(['bad'], 'bad.exe', {
        type: 'application/octet-stream',
      });
      await act(async () => {
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: [invalid],
        });
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(onChange).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();

      const replacement = new File(['%PDF-1.4'], 'replacement.pdf', {
        type: 'application/pdf',
      });
      await act(async () => {
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: [replacement],
        });
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(documents.current[0]?.selectedFile).toBe(replacement);
      const reset = container.querySelector<HTMLButtonElement>(
        'button[aria-label="파일 선택 취소"]',
      );
      if (reset === null)
        throw new TypeError('Missing local replacement reset.');
      await act(async () => reset.focus());
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
        '파일 선택 취소',
      );
      await act(async () => reset.click());
      expect(documents.current).toHaveLength(1);
      expect(documents.current[0]?.id).toBe('document-1');
      expect(documents.current[0]?.selectedFile).toBeNull();
      expect(documents.current[0]?.persistedTemplateFileName).toBe('plan.pdf');
      expect(container.textContent).toContain('plan.pdf');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      fetchMock.mockRestore();
    }
  });
});
