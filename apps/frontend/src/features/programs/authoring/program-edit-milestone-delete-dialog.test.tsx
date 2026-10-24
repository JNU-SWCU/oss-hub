import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushDelayedUnmount,
  pressEscape,
} from '@/components/dialog-shell-test-utils';
import type { EditableMilestone } from './dto';
import { ProgramEditMilestones } from './program-edit-milestones';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const noOp = () => undefined;

const milestone: EditableMilestone = {
  id: 'milestone-1',
  name: '기획서 제출',
  startAt: '2026-08-16T09:30:59.000Z',
  dueAt: '2026-08-20T12:30:59.000Z',
  submissionType: 'TEXT',
  instructions: null,
};

interface DeleteHarnessProps {
  readonly isBusy?: boolean;
  readonly onCancelDelete?: () => void;
  readonly onConfirmDelete?: () => void;
}

function DeleteHarness({
  isBusy = false,
  onCancelDelete = noOp,
  onConfirmDelete = noOp,
}: DeleteHarnessProps) {
  const [deleteTarget, setDeleteTarget] = useState<EditableMilestone | null>(
    null,
  );

  return (
    <ProgramEditMilestones
      milestones={[milestone]}
      editor={{ mode: 'closed' }}
      deleteTarget={deleteTarget}
      operationStartAt="2026-08-16T09:30:59.000Z"
      operationEndAt="2026-08-31T09:30:59.000Z"
      contextEvents={[]}
      isBusy={isBusy}
      canonicalDocumentsByMilestoneId={new Map([[milestone.id, []]])}
      onAdd={noOp}
      onEdit={noOp}
      onCancelEdit={noOp}
      onFieldChange={noOp}
      onSave={noOp}
      onRequestDelete={setDeleteTarget}
      onCancelDelete={() => {
        onCancelDelete();
        setDeleteTarget(null);
      }}
      onConfirmDelete={onConfirmDelete}
    />
  );
}

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

  expect(consoleErrors).toEqual([]);
});

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

function getTrashButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${milestone.name} 삭제"]`,
  );
  if (!button) throw new TypeError('Trash button not found');
  return button;
}

function getDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
  if (!dialog) throw new TypeError('Delete dialog not found');
  return dialog;
}

async function openDeleteDialog(props: DeleteHarnessProps = {}) {
  await act(async () => root.render(<DeleteHarness {...props} />));
  await act(async () => {
    const trash = getTrashButton();
    trash.focus();
    trash.click();
  });
  return getDialog();
}

describe('milestone delete confirmation copy', () => {
  it('states the irreversible outcome in the title', async () => {
    const dialog = await openDeleteDialog();

    expect(
      document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
        ?.textContent,
    ).toBe('마일스톤을 되돌릴 수 없이 삭제할까요?');
  });

  it('states template unavailability without promising storage deletion', async () => {
    const dialog = await openDeleteDialog();

    expect(dialog.textContent).toContain(
      '양식 파일은 OSS Hub에서 더 이상 이용할 수 없습니다.',
    );
    expect(dialog.textContent).not.toContain('양식 파일도 함께 삭제됩니다');
  });

  it('keeps the server-side refusal rule visible', async () => {
    const dialog = await openDeleteDialog();

    expect(dialog.textContent).toContain(
      '학생이 올린 제출물이 하나라도 있으면 삭제되지 않습니다.',
    );
  });

  it('does not repeat the title in the description', async () => {
    const dialog = await openDeleteDialog();

    expect(dialog.textContent).not.toContain(
      `${milestone.name} 마일스톤을 삭제합니다`,
    );
  });

  it('lets assistive technology read the warning as the dialog description', async () => {
    const dialog = await openDeleteDialog();

    expect(
      document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
        ?.textContent,
    ).toContain('학생이 올린 제출물이 하나라도 있으면 삭제되지 않습니다.');
  });
});

describe('milestone delete confirmation behavior', () => {
  it('opens only after the trash button is pressed and starts on 취소', async () => {
    await act(async () => root.render(<DeleteHarness />));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    await openDeleteDialog();

    expect(document.activeElement).toBe(getButton('취소'));
  });

  it('calls onCancelDelete once and closes when 취소 is pressed', async () => {
    const onCancelDelete = vi.fn();
    const onConfirmDelete = vi.fn();
    await openDeleteDialog({ onCancelDelete, onConfirmDelete });

    act(() => getButton('취소').click());
    await flushDelayedUnmount();

    expect(onCancelDelete).toHaveBeenCalledTimes(1);
    expect(onConfirmDelete).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('calls onConfirmDelete once when 삭제 확정 is pressed', async () => {
    const onCancelDelete = vi.fn();
    const onConfirmDelete = vi.fn();
    await openDeleteDialog({ onCancelDelete, onConfirmDelete });

    await act(async () => getButton('삭제 확정').click());

    expect(onConfirmDelete).toHaveBeenCalledTimes(1);
    expect(onCancelDelete).not.toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to the trash button', async () => {
    const onCancelDelete = vi.fn();
    const dialog = await openDeleteDialog({ onCancelDelete });
    const trash = getTrashButton();

    act(() => pressEscape(dialog));
    await flushDelayedUnmount();

    expect(onCancelDelete).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(trash);
  });

  it('ignores 취소, 삭제 확정 and Escape while the delete is running', async () => {
    const onCancelDelete = vi.fn();
    const onConfirmDelete = vi.fn();
    const dialog = await openDeleteDialog({ onCancelDelete, onConfirmDelete });

    await act(async () =>
      root.render(
        <DeleteHarness
          isBusy
          onCancelDelete={onCancelDelete}
          onConfirmDelete={onConfirmDelete}
        />,
      ),
    );
    await act(async () => pressEscape(dialog));
    await flushDelayedUnmount();

    expect(getButton('취소').disabled).toBe(true);
    expect(getButton('삭제 확정').disabled).toBe(true);
    expect(onCancelDelete).not.toHaveBeenCalled();
    expect(onConfirmDelete).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });
});
