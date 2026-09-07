// @vitest-environment happy-dom

import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  toMilestoneForm,
  type ProgramMilestoneForm,
} from './program-edit-flow';
import { ProgramEditMilestoneDialog } from './program-edit-milestone-dialog';
import type { EditableMilestoneEditSnapshot } from './api';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const form = toMilestoneForm({
  id: 'milestone-1',
  name: '기획서 제출',
  startAt: '2026-08-16T09:30:59.000Z',
  dueAt: '2026-08-20T09:30:59.000Z',
  submissionType: 'TEXT',
  instructions: '초안을 제출하세요.',
});
const passiveProps = {
  operationStartAt: '2026-08-01T09:00',
  operationEndAt: '2026-08-31T18:00',
  contextEvents: [],
  isBusy: false,
  returnFocusRef: { current: null },
  onCancel: vi.fn(),
  onFieldChange: vi.fn(),
  onSave: vi.fn(),
  snapshot: {
    milestone: {
      id: 'milestone-1',
      name: '기획서 제출',
      startAt: '2026-08-16T09:30:59.000Z',
      dueAt: '2026-08-20T09:30:59.000Z',
      submissionType: 'TEXT',
      instructions: '초안을 제출하세요.',
    },
    operation: {
      startAt: '2026-08-01T09:00:00.000Z',
      endAt: '2026-08-31T09:00:00.000Z',
    },
    documents: [],
    fileUpload: {
      maxBytes: 5242880,
      maxLabel: '5 MiB',
      accept: '.pdf',
      formatLabel: 'PDF',
    },
    fingerprint: 'a'.repeat(64),
  } satisfies EditableMilestoneEditSnapshot,
};

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

function pressEscape(target: EventTarget = document) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function waitForNextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function DialogHarness({
  startingForm,
  isBusy = false,
  withReturnFocus = true,
  onCancel,
}: {
  readonly startingForm: ProgramMilestoneForm;
  readonly isBusy?: boolean;
  readonly withReturnFocus?: boolean;
  readonly onCancel: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [currentForm, setCurrentForm] = useState(startingForm);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={returnFocusRef} type="button" onClick={() => setOpen(true)}>
        기획서 제출 수정
      </button>
      {open ? (
        <ProgramEditMilestoneDialog
          editor={{
            mode: 'edit',
            form: currentForm,
            initialForm: form,
            errors: {},
          }}
          operationStartAt="2026-08-01T09:00"
          operationEndAt="2026-08-31T18:00"
          contextEvents={[]}
          isBusy={isBusy}
          snapshot={passiveProps.snapshot}
          returnFocusRef={withReturnFocus ? returnFocusRef : undefined}
          onCancel={() => {
            onCancel();
            setCurrentForm(form);
            setOpen(false);
          }}
          onFieldChange={(field, value) =>
            setCurrentForm((current) => ({ ...current, [field]: value }))
          }
          onSave={vi.fn()}
        />
      ) : null}
    </>
  );
}

describe('ProgramEditMilestoneDialog', () => {
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

  it('uses the milestone name as the dialog title and keeps all fields populated', async () => {
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          contextEvents={[
            {
              id: 'application',
              label: '신청 기간',
              kind: 'APPLICATION',
              startAt: '2026-08-01T09:00',
              endAt: '2026-08-15T18:00',
            },
          ]}
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
        />,
      ),
    );
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('기획서 제출 수정');
    expect(dialog?.textContent).toContain('운영 기간');
    expect(dialog?.textContent).not.toContain('신청 기간');
    expect(
      (document.querySelector('#milestone-name') as HTMLInputElement).value,
    ).toBe('기획서 제출');
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-controls]')
        ?.click();
    });
    expect(
      document.querySelector<HTMLInputElement>('#milestone-start-at')?.value,
    ).not.toBe('');
    expect(
      document.querySelector<HTMLInputElement>('#milestone-due-at')?.value,
    ).not.toBe('');
  });

  it('keeps Korean instruction words intact on narrow dialog widths', async () => {
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
        />,
      ),
    );

    const instructions = document.querySelector('#milestone-instructions');
    expect(instructions?.classList.contains('break-keep')).toBe(true);
    expect(instructions?.classList.contains('whitespace-pre-wrap')).toBe(true);
    expect(instructions?.classList.contains('[overflow-wrap:anywhere]')).toBe(
      true,
    );
  });

  it('keeps form fields and local documents in one scroll body with a separate footer', async () => {
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
        />,
      ),
    );
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.querySelectorAll('form')).toHaveLength(1);
    expect(dialog?.querySelector('form')?.textContent).toContain('제출 항목');
    expect(
      dialog?.querySelector('form button[type="submit"]')?.textContent,
    ).toBe('마일스톤 저장');
    expect(dialog?.querySelector('form')?.textContent).toContain(
      '이름, 일정, 안내, 제출 항목과 양식 변경을 함께 저장합니다.',
    );
  });

  it('keeps the milestone dialog open when Escape cancels only a submission-item name edit', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          onCancel={onCancel}
          snapshot={{
            ...passiveProps.snapshot,
            documents: [
              {
                id: 'document-1',
                name: '기획서',
                required: true,
                sortOrder: 1,
                templateFileName: null,
              },
            ],
          }}
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
        />,
      ),
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="제출물 이름 수정"]')
        ?.click(),
    );
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="파일 제출물 이름"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      input?.focus();
      pressEscape(input ?? document);
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(
      document.querySelector('[aria-label="파일 제출물 이름"]'),
    ).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('closes a clean editor with one Escape and returns focus to its exact origin', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(<DialogHarness startingForm={form} onCancel={onCancel} />),
    );
    const origin = getButton('기획서 제출 수정');
    let originFocused = false;
    origin.addEventListener('focus', () => {
      originFocused = true;
    });
    await act(async () => {
      pressEscape(document.activeElement ?? document);
      await waitForNextFrame();
    });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(originFocused).toBe(true);
  });

  it('keeps dirty data through alert Escape and continue-editing, then discards once and restores origin focus', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <DialogHarness
          startingForm={{ ...form, name: '변경된 기획서' }}
          onCancel={onCancel}
        />,
      ),
    );

    const nameInput =
      document.querySelector<HTMLInputElement>('#milestone-name');
    if (!nameInput) throw new TypeError('Milestone name input not found');
    nameInput.focus();
    await act(async () => {
      pressEscape(nameInput);
    });
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain(
      '저장하지 않은 변경을 버릴까요?',
    );
    expect(document.body.textContent).toContain('버리면 되돌릴 수 없습니다.');
    expect(getButton('버리기')).toBeTruthy();
    expect(document.body.textContent).not.toContain('폐기');
    expect(onCancel).not.toHaveBeenCalled();
    expect(nameInput.value).toBe('변경된 기획서');

    let editorFocused = false;
    nameInput.addEventListener('focus', () => {
      editorFocused = true;
    });
    await act(async () => {
      pressEscape(document.activeElement ?? document);
      await waitForNextFrame();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(nameInput.value).toBe('변경된 기획서');
    expect(editorFocused).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();

    nameInput.focus();
    await act(async () => pressEscape(document.activeElement ?? document));
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    editorFocused = false;
    await act(async () => {
      getButton('계속 편집').click();
      await waitForNextFrame();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(nameInput.value).toBe('변경된 기획서');
    expect(editorFocused).toBe(true);

    await act(async () => pressEscape(document.activeElement ?? document));
    const origin = getButton('기획서 제출 수정');
    let originFocused = false;
    origin.addEventListener('focus', () => {
      originFocused = true;
    });
    await act(async () => {
      getButton('버리기').click();
      await waitForNextFrame();
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(originFocused).toBe(true);

    await act(async () => getButton('기획서 제출 수정').click());
    expect(
      document.querySelector<HTMLInputElement>('#milestone-name')?.value,
    ).toBe(form.name);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('focuses the first invalid field inside the portaled dialog', async () => {
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
        />,
      ),
    );
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          editor={{
            mode: 'edit',
            form,
            initialForm: form,
            errors: { dueAt: '마감일을 확인해 주세요.' },
          }}
        />,
      ),
    );

    /*
     * 단일 범위 편집기는 `layout="simple"` 이라 달력이 날짜 입력의 자리를 대신하고
     * 문서 순서상 먼저 농인다. 따라서 첫 무효 필드는 달력 스크롤 영역이다 —
     * `tabIndex=0`·`aria-invalid`·`aria-describedby` 를 갖추고 있어 그 자리에서
     * 키보드로 바로 날짜를 고칠 수 있다. 시각까지 고치려면 「일정 입력」이
     * 여는 `ProgramScheduleRangeDialog` 로 간다.
     */
    const calendarScroll = document.querySelector(
      '[data-testid="program-schedule-calendar-scroll"]',
    );
    expect(calendarScroll?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(calendarScroll);
  });

  it('ignores Escape and overlay close attempts while a save is in progress', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <DialogHarness
          startingForm={{ ...form, name: '변경' }}
          isBusy
          onCancel={onCancel}
        />,
      ),
    );
    await act(async () => {
      pressEscape(document.activeElement ?? document);
      const overlay = document.querySelector<HTMLElement>(
        '.fixed.inset-0.z-50',
      );
      overlay?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
      overlay?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, cancelable: true }),
      );
      overlay?.click();
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(
      '저장하지 않은 변경을 버릴까요?',
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('treats an exact revert as clean and does not double-close without a focus ref', async () => {
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        <DialogHarness
          startingForm={{ ...form }}
          withReturnFocus={false}
          onCancel={onCancel}
        />,
      ),
    );
    await act(async () => pressEscape(document.activeElement ?? document));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

/*
 * 단일 마일스톤 편집은 고를 범위가 하나뿐인데도 `aria-pressed` 선택기를 그렸고,
 * 호출부가 `onActiveIdChange={() => undefined}` 를 넘겨 **눌러도 아무 일도 일어나지
 * 않는 컨트롤**이었다. 스크린리더에는 눌린 버튼으로 읽히고 키보드 사용자는 탭 한 칸을
 * 잃었다. 근거: GOV.UK Question pages 의 "only ask for a piece of information once
 * within a single journey" 와 Norman 의 signifier — 작동하지 않는 것이 작동하는
 * 것처럼 보이면 안 된다.
 */
describe('단일 범위 편집기의 죽은 선택기 제거', () => {
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

  async function open() {
    await act(async () =>
      root.render(
        <ProgramEditMilestoneDialog
          {...passiveProps}
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
        />,
      ),
    );
  }

  it('선택기를 하나도 렌더하지 않는다', async () => {
    await open();
    expect(
      document.querySelectorAll('[data-schedule-range-selector]'),
    ).toHaveLength(0);
  });

  it('선택 상태 문구와 작성 순서 라벨을 내지 않는다', async () => {
    await open();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).not.toContain('선택 중');
    expect(dialog?.textContent).not.toContain('1. ');
    expect(document.querySelector('[aria-label="일정 작성 순서"]')).toBeNull();
    expect(document.querySelector('[aria-label="일정 선택"]')).toBeNull();
  });

  it('마일스톤 이름을 읽기 전용 컨텍스트로 그대로 보여준다', async () => {
    await open();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('기획서 제출');
  });

  it('「일정 입력」으로 날짜·시각을 고칠 길을 유지한다', async () => {
    await open();
    const scheduleButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="기획서 제출 일정 입력"]',
    );
    expect(scheduleButton).not.toBeNull();
    await act(async () => scheduleButton?.click());
    const dialogs = document.querySelectorAll('[role="dialog"]');
    const rangeDialog = dialogs[dialogs.length - 1];
    expect(
      rangeDialog?.querySelector('input[aria-label="기획서 제출 시작일"]'),
    ).not.toBeNull();
    expect(
      rangeDialog?.querySelector('input[aria-label="기획서 제출 종료 시각"]'),
    ).not.toBeNull();
  });

  it('운영 기간 밖 날짜를 고를 수 없도록 경계를 넘긴다', async () => {
    await open();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="기획서 제출 일정 입력"]',
        )
        ?.click(),
    );
    const startDate = document.querySelector<HTMLInputElement>(
      'input[aria-label="기획서 제출 시작일"]',
    );
    expect(startDate?.getAttribute('min')).toBe('2026-08-01');
    expect(startDate?.getAttribute('max')).toBe('2026-08-31');
  });
});
