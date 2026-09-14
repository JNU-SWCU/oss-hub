// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { RepositoryUrlEditor } from './repository-url-editor';
import {
  getRepositoryUrl,
  RepositoryUrlResponseError,
  updateRepositoryUrl,
  type RepositoryUrlState,
} from './repository-url-api';

vi.mock('./repository-url-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repository-url-api')>()),
  getRepositoryUrl: vi.fn(),
  updateRepositoryUrl: vi.fn(),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RepositoryUrlEditor', () => {
  let container: HTMLDivElement;
  let root: Root;
  const initial = {
    repositoryUrl: 'https://github.com/synthetic/original',
    canEditRepositoryUrl: true,
  };
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(getRepositoryUrl).mockReset().mockResolvedValue(initial);
    vi.mocked(updateRepositoryUrl).mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  async function render(programId = 'program-1') {
    await act(async () =>
      root.render(<RepositoryUrlEditor programId={programId} />),
    );
  }
  async function click(label: string) {
    const button = Array.from(document.body.querySelectorAll('button')).find(
      (element) => element.textContent === label,
    );
    if (!button) throw new Error(`Missing button ${label}`);
    await act(async () => button.click());
  }
  async function fill(selector: string, value: string) {
    const input = container.querySelector(selector);
    if (!(
      input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
    ))
      throw new Error('Missing input');
    const prototype =
      input instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function submit() {
    const form = container.querySelector('form');
    await act(async () =>
      form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
  }
  it('makes no mutation when the editor is cancelled', async () => {
    // Given
    await render();
    await click('저장소 URL 수정');
    // When
    await click('취소');
    // Then
    expect(updateRepositoryUrl).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
  });
  it.each([
    ['#repository-url', 'https://github.com/synthetic/replacement'],
    ['#repository-url-reason', '수정 중인 사유'],
  ])(
    'preserves dirty %s until discard is confirmed',
    async (selector, value) => {
      await render();
      await click('저장소 URL 수정');
      await fill(selector, value);
      await click('취소');
      expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
      expect(updateRepositoryUrl).not.toHaveBeenCalled();
      await click('이어서 수정하기');
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(container.querySelector<HTMLInputElement>(selector)?.value).toBe(
        value,
      );
      await click('취소');
      await click('변경사항 버리기');
      expect(container.querySelector('form')).toBeNull();
      expect(updateRepositoryUrl).not.toHaveBeenCalled();
      await click('저장소 URL 수정');
      expect(
        container.querySelector<HTMLInputElement>('#repository-url')?.value,
      ).toBe(initial.repositoryUrl);
      expect(
        container.querySelector<HTMLTextAreaElement>('#repository-url-reason')
          ?.value,
      ).toBe('');
    },
  );
  it('keeps Korean warning words together in the narrow editor', async () => {
    // Given
    await render();
    // When
    await click('저장소 URL 수정');
    // Then
    expect(
      container.querySelector('form [data-slot="alert-description"]')
        ?.className,
    ).toContain('break-keep');
  });
  it('rejects whitespace-only reasons before mutation', async () => {
    // Given
    await render();
    await click('저장소 URL 수정');
    await fill('#repository-url-reason', '   ');
    // When
    await submit();
    // Then
    expect(updateRepositoryUrl).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-invalid="true"]')).not.toBeNull();
  });
  it('retains both inputs when saving fails', async () => {
    // Given
    vi.mocked(updateRepositoryUrl).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: '요청 처리 실패',
        status: 400,
        detail: '서버가 거절한 합성 오류입니다.',
        instance: '/programs/program-1',
        code: 'VAL_001',
      }),
    );
    await render();
    await click('저장소 URL 수정');
    await fill('#repository-url', 'https://github.com/synthetic/replacement');
    await fill(
      '#repository-url-reason',
      'Moved project\nPreserve project history',
    );
    // When
    await submit();
    // Then
    expect(
      container.querySelector<HTMLInputElement>('#repository-url')?.value,
    ).toBe('https://github.com/synthetic/replacement');
    expect(
      container.querySelector<HTMLTextAreaElement>('#repository-url-reason')
        ?.value,
    ).toBe('Moved project\nPreserve project history');
    expect(container.textContent).toContain('서버가 거절한 합성 오류입니다.');
    expect(container.textContent).toContain('재시도하세요');
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false);
    expect(getRepositoryUrl).toHaveBeenCalledTimes(1);
    const errorDescription = container.querySelector(
      'section > [role="alert"] [data-slot="alert-description"]',
    );
    expect(errorDescription?.className).toContain('grid');
    expect(errorDescription?.firstElementChild?.tagName).toBe('P');
    expect(errorDescription?.className).toContain('text-wrap');
    expect(errorDescription?.firstElementChild?.className).toContain(
      'whitespace-pre-line',
    );
  });
  it('applies the PATCH body without a follow-up GET', async () => {
    // Given
    const replacement = {
      ...initial,
      repositoryUrl: 'https://github.com/synthetic/replacement',
    };
    vi.mocked(updateRepositoryUrl).mockResolvedValue(replacement);
    await render();
    await click('저장소 URL 수정');
    await fill('#repository-url', replacement.repositoryUrl);
    await fill(
      '#repository-url-reason',
      'Moved project\nPreserve project history',
    );
    // When
    await submit();
    // Then
    expect(updateRepositoryUrl).toHaveBeenCalledWith('program-1', {
      repositoryUrl: replacement.repositoryUrl,
      reason: 'Moved project\nPreserve project history',
    });
    expect(getRepositoryUrl).toHaveBeenCalledTimes(1);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      replacement.repositoryUrl,
    );
    expect(container.querySelector('form')).toBeNull();
  });
  it('disables editing when the server denies capability after end or for a member', async () => {
    // Given
    vi.mocked(getRepositoryUrl).mockResolvedValue({
      ...initial,
      canEditRepositoryUrl: false,
    });
    // When
    await render();
    // Then
    expect(container.querySelector('button')?.disabled).toBe(true);
  });
  it('does not keep the previous program URL, draft, or edit permission while the next program loads', async () => {
    const next = deferred<RepositoryUrlState>();
    vi.mocked(getRepositoryUrl)
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(next.promise);
    await render('program-1');
    await click('저장소 URL 수정');
    await fill('#repository-url', 'https://github.com/synthetic/draft');
    await fill('#repository-url-reason', '작성 중이던 사유');
    await render('program-2');
    expect(container.textContent).toContain('저장소를 불러오는 중');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).not.toContain(initial.repositoryUrl);
    expect(container.textContent).not.toContain(
      'https://github.com/synthetic/draft',
    );
    expect(container.textContent).not.toContain('작성 중이던 사유');
    await act(async () => {
      next.resolve({
        repositoryUrl: 'https://github.com/synthetic/other',
        canEditRepositoryUrl: false,
      });
      await next.promise;
    });
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://github.com/synthetic/other',
    );
    expect(container.querySelector('button')?.disabled).toBe(true);
  });
  it('does not let a delayed GET replace the current program or a confirmed save', async () => {
    const first = deferred<RepositoryUrlState>();
    const second = deferred<RepositoryUrlState>();
    const saved = {
      repositoryUrl: 'https://github.com/synthetic/program-2',
      canEditRepositoryUrl: true,
    };
    vi.mocked(getRepositoryUrl).mockImplementation((programId) =>
      programId === 'program-1' ? first.promise : second.promise,
    );
    vi.mocked(updateRepositoryUrl).mockResolvedValue(saved);
    await render('program-1');
    await render('program-2');
    expect(container.textContent).toContain('저장소를 불러오는 중');
    expect(container.querySelector('a')).toBeNull();
    await act(async () => {
      second.resolve({
        repositoryUrl: 'https://github.com/synthetic/program-2-original',
        canEditRepositoryUrl: true,
      });
      await second.promise;
    });
    await click('저장소 URL 수정');
    await fill('#repository-url', saved.repositoryUrl);
    await fill('#repository-url-reason', '프로그램 전환 후 저장');
    await submit();
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      saved.repositoryUrl,
    );
    await act(async () => {
      first.resolve(initial);
      await first.promise;
    });
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      saved.repositoryUrl,
    );
    expect(container.textContent).not.toContain(initial.repositoryUrl);
  });
  it('does not apply a delayed reload over a later confirmed save', async () => {
    const delayed = deferred<RepositoryUrlState>();
    const replacement = {
      ...initial,
      repositoryUrl: 'https://github.com/synthetic/replacement',
    };
    vi.mocked(getRepositoryUrl)
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(delayed.promise);
    vi.mocked(updateRepositoryUrl)
      .mockRejectedValueOnce(
        new ApiError({
          type: 'about:blank',
          title: '요청 처리 실패',
          status: 400,
          detail: '서버가 거절한 합성 오류입니다.',
          instance: '/programs/program-1',
          code: 'VAL_001',
        }),
      )
      .mockResolvedValueOnce(replacement);
    await render();
    await click('저장소 URL 수정');
    await fill('#repository-url', replacement.repositoryUrl);
    await fill('#repository-url-reason', '사유');
    await submit();
    expect(container.textContent).toContain('서버가 거절한 합성 오류입니다.');
    expect(container.textContent).toContain('재시도하세요');
    await click('다시 불러오기');
    await submit();
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      replacement.repositoryUrl,
    );
    expect(container.querySelector('form')).toBeNull();
    await act(async () => {
      delayed.resolve(initial);
      await delayed.promise;
    });
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      replacement.repositoryUrl,
    );
  });
  it('retains an unconfirmed save and does not PATCH again until the current state is read back', async () => {
    const replacement = 'https://github.com/synthetic/replacement';
    const reason = 'Moved project\nPreserve project history';
    vi.mocked(updateRepositoryUrl).mockRejectedValue(
      new RepositoryUrlResponseError(),
    );
    await render();
    await click('저장소 URL 수정');
    await fill('#repository-url', replacement);
    await fill('#repository-url-reason', reason);
    await submit();
    expect(
      container.querySelector<HTMLInputElement>('#repository-url')?.value,
    ).toBe(replacement);
    expect(
      container.querySelector<HTMLTextAreaElement>('#repository-url-reason')
        ?.value,
    ).toBe(reason);
    expect(container.textContent).toContain('저장 결과를 확인할 수 없습니다');
    expect(container.textContent).toContain(
      '다시 불러와 현재 상태를 확인한 뒤에만 저장하세요',
    );
    expect(container.textContent).not.toContain('재시도하세요');
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(true);
    await submit();
    expect(updateRepositoryUrl).toHaveBeenCalledTimes(1);
    await click('다시 불러오기');
    expect(container.textContent).not.toContain(
      '저장 결과를 확인할 수 없습니다',
    );
    expect(
      container.querySelector<HTMLInputElement>('#repository-url')?.value,
    ).toBe(replacement);
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false);
    await submit();
    expect(updateRepositoryUrl).toHaveBeenCalledTimes(2);
  });
});
