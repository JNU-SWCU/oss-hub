// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  downloadMilestoneDocumentCurrentFile,
  listMilestoneDocumentCurrentFiles,
} from './api';
import { MilestoneDocumentCurrentFiles } from './milestone-document-current-files';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('./api', () => ({
  downloadMilestoneDocumentCurrentFile: vi.fn(),
  listMilestoneDocumentCurrentFiles: vi.fn(),
}));

const documents = [
  {
    id: 'document-file-current',
    name: '현재 계획서',
    submissionType: 'FILE' as const,
    viewerSubmission: { submitted: true, hasCurrentFile: true },
  },
  {
    id: 'document-text-current',
    name: '현재 텍스트',
    submissionType: 'TEXT' as const,
    viewerSubmission: { submitted: true, hasCurrentFile: true },
  },
  {
    id: 'document-file-missing',
    name: '미제출 파일',
    submissionType: 'FILE' as const,
    viewerSubmission: { submitted: false, hasCurrentFile: false },
  },
];

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) throw new Error('deferred not initialized');
  return { promise, resolve: resolvePromise };
}

describe('MilestoneDocumentCurrentFiles', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(listMilestoneDocumentCurrentFiles).mockResolvedValue(documents);
    vi.mocked(downloadMilestoneDocumentCurrentFile).mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(<MilestoneDocumentCurrentFiles milestoneId="milestone-1" />);
    });
  }

  it('기존 방식과 관계없이 실제 현재 파일이 있는 항목을 보여준다', async () => {
    // When
    await render();

    // Then
    expect(
      container.querySelector(
        'button[aria-label="현재 계획서 현재 제출 파일 내려받기"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain('현재 텍스트');
    expect(container.textContent).not.toContain('미제출 파일');
  });

  it('내려받는 동안 버튼과 aria-live 상태를 busy로 유지하고 서버 파일명으로 저장한다', async () => {
    // Given
    const download = deferred<{
      readonly blob: Blob;
      readonly fileName: string;
    }>();
    vi.mocked(downloadMilestoneDocumentCurrentFile).mockReturnValue(
      download.promise,
    );
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:current-file');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await render();
    const button = container.querySelector('button');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('download button expected');
    }

    // When
    await act(async () => button.click());

    // Then
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      '현재 계획서 내려받는 중',
    );

    await act(async () => {
      download.resolve({ blob: new Blob(['current']), fileName: '현재.pdf' });
      await download.promise;
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:current-file');
    expect(button.disabled).toBe(false);
  });

  it('404를 포함한 다운로드 실패를 현재 패널의 alert로 알리고 재시도를 허용한다', async () => {
    // Given
    vi.mocked(downloadMilestoneDocumentCurrentFile).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: '제출된 파일을 찾을 수 없습니다.',
        instance: '/current/file',
        code: 'MSD_020',
      }),
    );
    await render();
    const button = container.querySelector('button');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('download button expected');
    }

    // When
    await act(async () => button.click());

    // Then
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '제출된 파일을 찾을 수 없습니다.',
    );
    expect(button.disabled).toBe(false);
  });
});
