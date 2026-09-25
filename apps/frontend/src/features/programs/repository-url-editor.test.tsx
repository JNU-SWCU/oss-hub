// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { RepositoryUrlEditor } from './repository-url-editor';
import {
  RepositoryUrlResponseError,
  type RepositoryUrlState,
} from './repository-url-api';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const LOCKED_HINT =
  '승인된 팀의 팀장만 프로그램 종료 전까지 변경할 수 있습니다.';

function rejected(): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: '요청 처리 실패',
    status: 400,
    detail: '서버가 거절한 합성 오류입니다.',
    instance: '/programs/program-1',
    code: 'VAL_001',
  });
}

describe('RepositoryUrlEditor', () => {
  let container: HTMLDivElement;
  let root: Root;
  const initial: RepositoryUrlState = {
    repositoryUrl: 'https://github.com/synthetic/original',
    canEditRepositoryUrl: true,
  };
  const save = vi.fn<(repositoryUrl: string) => Promise<RepositoryUrlState>>();
  const reload = vi.fn<() => Promise<boolean>>();
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    save.mockReset();
    reload.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  /** 부모(`TeamRepositoryPanel`)가 서버를 새로 읽을 때마다 새 객체를 내려 주는 것과 같다. */
  async function render(repository: RepositoryUrlState = initial) {
    await act(async () =>
      root.render(
        <RepositoryUrlEditor
          repository={repository}
          save={save}
          reload={reload}
          lockedHint={LOCKED_HINT}
        />,
      ),
    );
  }
  function button(label: string): HTMLButtonElement {
    const found = Array.from(document.body.querySelectorAll('button')).find(
      (element) =>
        (element.getAttribute('aria-label') ?? element.textContent) === label,
    );
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
  }
  async function fill(value: string) {
    const input = container.querySelector<HTMLInputElement>('#repository-url');
    if (!input) throw new Error('Missing input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, value);
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
  function input(): HTMLInputElement | null {
    return container.querySelector<HTMLInputElement>('#repository-url');
  }
  function link(): string | null | undefined {
    return container.querySelector('a')?.getAttribute('href');
  }

  it('makes no mutation when the editor is cancelled', async () => {
    await render();
    await click('저장소 URL 수정');
    await click('취소');
    expect(save).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
  });
  it('preserves a dirty URL until discard is confirmed', async () => {
    const value = 'https://github.com/synthetic/replacement';
    await render();
    await click('저장소 URL 수정');
    await fill(value);
    await click('취소');
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click('이어서 수정하기');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(input()?.value).toBe(value);
    await click('취소');
    await click('변경사항 버리기');
    expect(container.querySelector('form')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    await click('저장소 URL 수정');
    expect(input()?.value).toBe(initial.repositoryUrl);
  });
  it('puts keep-editing before the destructive discard in the confirmation footer', async () => {
    await render();
    await click('저장소 URL 수정');
    await fill('https://github.com/synthetic/replacement');
    await click('취소');
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="alertdialog"] [data-slot="button"]',
      ),
    );
    expect(buttons.map((item) => item.textContent)).toEqual([
      '이어서 수정하기',
      '변경사항 버리기',
    ]);
    expect(buttons.map((item) => item.dataset.variant)).toEqual([
      'outline',
      'destructive',
    ]);
  });
  it('saves only the URL through the route the screen chose and applies the answer without a reload', async () => {
    const replacement = {
      ...initial,
      repositoryUrl: 'https://github.com/synthetic/replacement',
    };
    save.mockResolvedValue(replacement);
    await render();
    await click('저장소 URL 수정');
    expect(container.querySelector('form [role="alert"]')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    await fill(replacement.repositoryUrl);
    await submit();
    expect(save).toHaveBeenCalledExactlyOnceWith(replacement.repositoryUrl);
    expect(reload).not.toHaveBeenCalled();
    expect(link()).toBe(replacement.repositoryUrl);
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      '저장소 변경을 저장했습니다.',
    );
  });
  it('retains the URL and retry path when the server rejects the change', async () => {
    save.mockRejectedValue(rejected());
    await render();
    await click('저장소 URL 수정');
    await fill('https://github.com/synthetic/replacement');
    await submit();
    expect(input()?.value).toBe('https://github.com/synthetic/replacement');
    expect(container.textContent).toContain('서버가 거절한 합성 오류입니다.');
    expect(container.textContent).toContain('재시도하세요');
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false);
    const description = container.querySelector(
      'section > [role="alert"] [data-slot="alert-description"]',
    );
    expect(description?.className).toContain('text-wrap');
    expect(description?.firstElementChild?.className).toContain(
      'whitespace-pre-line',
    );
  });
  it('disables editing and says who may edit when the server denies it', async () => {
    await render({ ...initial, canEditRepositoryUrl: false });
    const edit = button('저장소 URL 수정');
    expect(edit.disabled).toBe(true);
    expect(container.textContent).toContain(LOCKED_HINT);
    // 잠긴 이유는 화면에 보이기만 하지 않고 연필의 접근 가능한 설명으로도 연결된다.
    const describedBy = edit.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(
      LOCKED_HINT,
    );
  });
  it('follows permission the screen re-reads — a leader change closes the open editor', async () => {
    // Given: the leader is editing.
    await render();
    await click('저장소 URL 수정');
    await fill('https://github.com/synthetic/draft');
    // When: the screen reads the server again and leadership has moved.
    await render({ ...initial, canEditRepositoryUrl: false });
    // Then
    expect(container.querySelector('form')).toBeNull();
    expect(button('저장소 URL 수정').disabled).toBe(true);
    // When: approval (or a new leader) grants it back on the next read.
    await render({ ...initial });
    expect(button('저장소 URL 수정').disabled).toBe(false);
    expect(container.textContent).not.toContain(LOCKED_HINT);
  });
  it('keeps a draft when a re-read does not change permission', async () => {
    await render();
    await click('저장소 URL 수정');
    await fill('https://github.com/synthetic/draft');
    await render({ ...initial });
    expect(input()?.value).toBe('https://github.com/synthetic/draft');
  });
  it('retains an unconfirmed save and does not save again until the state is read back', async () => {
    const replacement = 'https://github.com/synthetic/replacement';
    save.mockRejectedValue(new RepositoryUrlResponseError());
    reload.mockImplementation(async () => {
      await render({ ...initial, repositoryUrl: replacement });
      return true;
    });
    await render();
    await click('저장소 URL 수정');
    await fill(replacement);
    await submit();
    expect(input()?.value).toBe(replacement);
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
    expect(save).toHaveBeenCalledTimes(1);
    await click('다시 불러오기');
    expect(reload).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain(
      '저장 결과를 확인할 수 없습니다',
    );
    expect(link()).toBe(replacement);
    expect(input()?.value).toBe(replacement);
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false);
    await submit();
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('says the reload failed and keeps saving blocked', async () => {
    save.mockRejectedValue(new RepositoryUrlResponseError());
    reload.mockRejectedValue(new Error('Synthetic failure'));
    await render();
    await click('저장소 URL 수정');
    await fill('https://github.com/synthetic/replacement');
    await submit();
    await click('다시 불러오기');
    expect(container.textContent).toContain('다시 불러오지 못했습니다');
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(true);
  });
});
