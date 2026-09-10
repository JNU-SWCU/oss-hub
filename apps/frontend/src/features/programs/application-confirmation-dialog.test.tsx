// @vitest-environment happy-dom

import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationConfirmationDialog } from './application-confirmation-dialog';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function ApplicationConfirmationDialogHarness({
  onClose = () => {},
}: {
  readonly onClose?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={returnFocusRef} type="button" disabled={submitting}>
        수정 내용 저장
      </button>
      <ApplicationConfirmationDialog
        kind="save"
        submitting={submitting}
        onClose={onClose}
        onConfirm={() => setSubmitting(true)}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}

/** 부모가 확인창을 열고 닫는 실제 사용 형태(신청 실패 후 재시도 포함). */
function ApplicationRetryHarness({
  onClose,
}: {
  readonly onClose: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [openKind, setOpenKind] = useState<'save' | 'submit' | null>('save');
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={returnFocusRef} type="button">
        수정 내용 저장
      </button>
      <button
        type="button"
        onClick={() => {
          // 실패 응답 뒤 재시도: 이전 확인창을 버리고 새 확인창을 즉시 연다.
          setAttempt((current) => current + 1);
          setOpenKind('submit');
        }}
      >
        재시도
      </button>
      <button type="button" onClick={() => setOpenKind(null)}>
        프로그램 닫기
      </button>
      {openKind === null ? null : (
        <ApplicationConfirmationDialog
          key={`${openKind}-${attempt}`}
          kind={openKind}
          submitting={false}
          onClose={() => {
            onClose();
            setOpenKind(null);
          }}
          onConfirm={() => {}}
          returnFocusRef={returnFocusRef}
        />
      )}
    </>
  );
}

/** Radix FocusScope는 언마운트 정리를 매크로태스크로 미룬다. 그 이후까지 기다린다. */
async function flushDelayedUnmount() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

describe('ApplicationConfirmationDialog', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleErrors: unknown[][];

  beforeEach(() => {
    consoleErrors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args);
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    // 이 파일은 테스트가 통과해도 act 경고를 남긴 적이 있다(QA27). 경고 자체도
    // 회귀 신호로 취급해야 같은 비동기 경계가 다시 흐려지지 않는다.
    expect(consoleErrors).toEqual([]);
  });

  it('Escape로 닫으면 실제 Radix AlertDialog가 원래 저장 버튼에 포커스를 돌려준다', async () => {
    await act(async () =>
      root.render(<ApplicationConfirmationDialogHarness />),
    );

    const cancelButton = getButton('취소');
    const returnButton = getButton('수정 내용 저장');
    const focusReturned = new Promise<void>((resolve) => {
      returnButton.addEventListener('focus', () => resolve(), { once: true });
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(cancelButton);

    await act(async () => {
      cancelButton.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await focusReturned;

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(returnButton);
  });

  it('취소를 클릭해 닫아도 원래 저장 버튼에 포커스를 돌려준다', async () => {
    // Given
    await act(async () =>
      root.render(<ApplicationConfirmationDialogHarness />),
    );
    const cancelButton = getButton('취소');
    const returnButton = getButton('수정 내용 저장');
    const focusReturned = new Promise<void>((resolve) => {
      returnButton.addEventListener('focus', () => resolve(), { once: true });
    });

    // When
    await act(async () => {
      cancelButton.click();
      await focusReturned;
    });

    // Then
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(returnButton);
  });
  it('확인 중에는 실제 AlertDialog를 열어 두고 중복 확정을 막는다', async () => {
    await act(async () =>
      root.render(<ApplicationConfirmationDialogHarness />),
    );

    const confirmButton = document
      .querySelector('[role="alertdialog"]')
      ?.querySelector<HTMLButtonElement>('button:last-child');
    if (!confirmButton) throw new TypeError('Confirm button not found');
    await act(async () => confirmButton.click());

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(getButton('처리 중…').disabled).toBe(true);
    expect(getButton('취소').disabled).toBe(true);
  });

  it('취소 클릭은 지연 정리까지 끝난 뒤에도 onClose를 정확히 한 번만 호출한다', async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(<ApplicationConfirmationDialogHarness onClose={onClose} />),
    );

    await act(async () => getButton('취소').click());
    await flushDelayedUnmount();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape로 닫아도 onClose를 정확히 한 번만 호출한다', async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(<ApplicationConfirmationDialogHarness onClose={onClose} />),
    );

    await act(async () => {
      getButton('취소').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushDelayedUnmount();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('확정 처리 중에는 취소와 Escape가 onClose를 호출하지 않는다', async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(<ApplicationConfirmationDialogHarness onClose={onClose} />),
    );
    const confirmButton = document
      .querySelector('[role="alertdialog"]')
      ?.querySelector<HTMLButtonElement>('button:last-child');
    if (!confirmButton) throw new TypeError('Confirm button not found');
    await act(async () => confirmButton.click());

    await act(async () => {
      const cancelButton = getButton('취소');
      cancelButton.click();
      cancelButton.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushDelayedUnmount();

    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('부모가 언마운트해 닫힌 경우에는 Radix 지연 정리 뒤에도 onClose가 없다', async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(<ApplicationRetryHarness onClose={onClose} />),
    );
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    await act(async () => getButton('프로그램 닫기').click());
    await flushDelayedUnmount();

    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('이전 확인창의 언마운트가 새로 연 재시도 확인창을 닫지 못한다', async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(<ApplicationRetryHarness onClose={onClose} />),
    );

    await act(async () => getButton('재시도').click());
    await flushDelayedUnmount();

    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(
      document
        .querySelector('[role="alertdialog"]')
        ?.textContent?.includes('신청서를 제출하시겠습니까?'),
    ).toBe(true);
  });
});
