// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogShell, type DialogShellProps } from './dialog-shell';
import { Button } from './ui/button';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('DialogShell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(props: Partial<DialogShellProps> = {}) {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const {
      children = <input aria-label="팀 이름" defaultValue="가팀" />,
      ...rest
    } = props;
    await act(async () => {
      root.render(
        <DialogShell
          title="팀 이름 변경"
          description="새 이름을 입력하세요."
          onCancel={onCancel}
          onSave={onSave}
          {...(rest as object)}
        >
          {children}
        </DialogShell>,
      );
    });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const button = (name: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (element) => element.textContent === name,
      );
    return { dialog, button, onCancel, onSave };
  }

  it('기본은 dialog 역할을 지키고 alert 는 alertdialog 가 된다', async () => {
    /*
     * Radix 는 자기 `role: 'dialog'` 뒤에 전달 props 를 펼친다. 껍데기가
     * `role={undefined}` 를 넘기면 기본 역할이 지워져 앱의 모든 창이 역할을
     * 잃는다 — 이 테스트가 그것을 막는다.
     */
    await render();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    await render({ kind: 'alert' });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('alert는 본문보다 취소 버튼에 먼저 초점을 둔다', async () => {
    const { button } = await render({
      kind: 'alert',
      children: <textarea aria-label="반려 사유" />,
      footer: (
        <>
          <Button type="button">취소</Button>
          <Button type="button">확정</Button>
        </>
      ),
    });

    expect(document.activeElement).toBe(button('취소'));
  });

  it('제목·설명·본문·취소/저장 줄을 한 창에 그린다', async () => {
    const { dialog, button, onCancel, onSave } = await render();

    expect(dialog?.dataset.slot).toBe('dialog-shell');
    expect(dialog?.dataset.size).toBe('md');
    expect(dialog?.textContent).toContain('팀 이름 변경');
    expect(dialog?.textContent).toContain('새 이름을 입력하세요.');
    expect(dialog?.querySelector('[aria-label="팀 이름"]')).not.toBeNull();
    // 껍데기는 X 아이콘을 두지 않는다 — 닫기는 바닥 줄의 「취소」 하나다.
    expect(dialog?.querySelector('[aria-label="닫기"]')).toBeNull();

    await act(async () => button('저장')?.click());
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => button('취소')?.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('footer를 주면 취소·저장 대신 그 버튼 줄을 그리고 크기 변형을 적는다', async () => {
    const { dialog, button } = await render({
      size: 'lg',
      onSave: undefined,
      footer: (
        <Button type="button" onClick={() => {}}>
          닫기
        </Button>
      ),
    } as Partial<DialogShellProps>);

    expect(dialog?.dataset.size).toBe('lg');
    expect(button('닫기')).toBeDefined();
    expect(button('저장')).toBeUndefined();
    expect(button('취소')).toBeUndefined();
  });

  it('Escape는 창을 닫지만 busy 동안에는 닫지 않는다', async () => {
    const { dialog, onCancel } = await render();
    await act(async () => {
      dialog?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    const busy = await render({ busy: true });
    await act(async () => {
      busy.dialog?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(busy.onCancel).not.toHaveBeenCalled();
    expect(busy.button('저장')?.disabled).toBe(true);
  });

  it('open이 false면 아무것도 그리지 않는다', async () => {
    await render({ open: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
