// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryUrlEditor } from './repository-url-editor';
import { getRepositoryUrl, updateRepositoryUrl } from './repository-url-api';

vi.mock('./repository-url-api', () => ({
  getRepositoryUrl: vi.fn(),
  updateRepositoryUrl: vi.fn(),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

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
  async function render() {
    await act(async () =>
      root.render(<RepositoryUrlEditor programId="program-1" />),
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
      new Error('Synthetic failure'),
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
  it('refreshes only after the server confirms the new repository', async () => {
    // Given
    const replacement = {
      ...initial,
      repositoryUrl: 'https://github.com/synthetic/replacement',
    };
    vi.mocked(updateRepositoryUrl).mockResolvedValue(replacement);
    vi.mocked(getRepositoryUrl)
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(replacement);
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
    expect(getRepositoryUrl).toHaveBeenCalledTimes(2);
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
});
