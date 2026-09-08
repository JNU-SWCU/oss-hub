// @vitest-environment happy-dom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditableProgram } from './api';
import {
  buildProgramEditInput,
  toProgramEditForm,
  type ProgramEditableField,
  type ProgramEditForm,
} from './program-edit-flow';
import { PROGRAM_END_AT_UNDECIDED } from './program-end-at';
import { addDirtyField, updateProgramForm } from './program-edit-state';
import { ProgramEditView } from './program-edit-view';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const noOp = () => undefined;
const datedProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: 'SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  applicationStartAt: '2026-08-01T09:30:59.123Z',
  applicationEndAt: '2026-08-15T09:30:59.123Z',
  startAt: '2026-08-16T09:30:59.123Z',
  endAt: '2026-08-31T09:30:59.123Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: false,
  description: '프로그램 설명',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [],
};

function Harness({
  program,
  isSaving = false,
  onForm,
}: {
  readonly program: EditableProgram;
  readonly isSaving?: boolean;
  readonly onForm: (
    form: ProgramEditForm,
    dirty: readonly ProgramEditableField[],
  ) => void;
}) {
  const [form, setForm] = useState(() => toProgramEditForm(program));
  const [dirty, setDirty] = useState<readonly ProgramEditableField[]>([]);
  onForm(form, dirty);
  return (
    <ProgramEditView
      program={program}
      form={form}
      errors={{}}
      toastMessage={null}
      generalAlert={null}
      isSaving={isSaving}
      milestoneEditor={{ mode: 'closed' }}
      deleteTarget={null}

      isMilestoneBusy={false}
      isLifecycleBusy={false}
      isLifecycleConfirming={false}
      lifecycleError={null}
      canDeleteProgram={false}
      onFieldChange={(field, value) => {
        setForm((current) => updateProgramForm(current, field, value));
        setDirty((current) => addDirtyField(current, field));
      }}
      onSubmit={vi.fn()}
      onRequestLifecycleToggle={noOp}
      onCancelLifecycleToggle={noOp}
      onConfirmLifecycleToggle={noOp}
      onAddMilestone={noOp}
      onEditMilestone={noOp}
      onCancelMilestone={noOp}
      onMilestoneFieldChange={noOp}
      onSaveMilestone={vi.fn()}
      onRequestDeleteMilestone={noOp}
      onCancelDelete={noOp}
      onConfirmDelete={vi.fn()}
    />
  );
}

describe('프로그램 편집 일정 dialog — 종료일 미정', () => {
  let container: HTMLDivElement;
  let root: Root;
  let form = toProgramEditForm(datedProgram);
  let dirty: readonly ProgramEditableField[] = [];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    form = toProgramEditForm(datedProgram);
    dirty = [];
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(program = datedProgram, isSaving = false) {
    await act(async () => {
      root.render(
        <Harness
          program={program}
          isSaving={isSaving}
          onForm={(next, fields) => {
            form = next;
            dirty = fields;
          }}
        />,
      );
    });
  }

  async function openOperation() {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="운영 기간 수정"]')
        ?.click();
    });
  }

  function button(name: string): HTMLButtonElement {
    const value = [
      ...document.body.querySelectorAll<HTMLButtonElement>('button'),
    ].find((candidate) => candidate.textContent?.trim() === name);
    if (value === undefined) throw new TypeError(`Missing ${name}.`);
    return value;
  }

  it('local 종료일 미정은 종료 입력을 비활성화하고 취소하면 form/dirty를 바꾸지 않는다', async () => {
    await render();
    await openOperation();
    const toggle = document.body.querySelector<HTMLInputElement>(
      '#program-end-at-undecided',
    );
    const endDate = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="운영 기간 종료일"]',
    );
    if (toggle === null || endDate === null)
      throw new TypeError('Missing end controls.');

    await act(async () => toggle.click());
    expect(endDate.disabled).toBe(true);
    await act(async () => button('취소').click());

    expect(form.endAtUndecided).toBe(false);
    expect(form.endAt).toBe('2026-08-31T18:30');
    expect(dirty).toEqual([]);
  });

  it('Escape는 local 변경을 버리고 같은 수정 버튼으로 초점을 돌린다', async () => {
    await render();
    await openOperation();
    const toggle = document.body.querySelector<HTMLInputElement>(
      '#program-end-at-undecided',
    );
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    if (toggle === null || dialog === null)
      throw new TypeError('Missing dialog.');
    await act(async () => toggle.click());
    await act(async () =>
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );

    expect(form.endAtUndecided).toBe(false);
    expect(dirty).toEqual([]);
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="운영 기간 수정"]'),
    );
  });

  it('미정 적용은 센티널만 저장하고, 해제한 빈 종료일은 적용 전에 막는다', async () => {
    await render();
    await openOperation();
    const toggle = document.body.querySelector<HTMLInputElement>(
      '#program-end-at-undecided',
    );
    if (toggle === null) throw new TypeError('Missing undecided control.');
    await act(async () => toggle.click());
    await act(async () => button('날짜 적용').click());
    expect(form.endAtUndecided).toBe(true);
    expect(buildProgramEditInput(form, dirty).endAt).toBe(
      PROGRAM_END_AT_UNDECIDED,
    );

    await openOperation();
    const reopenedToggle = document.body.querySelector<HTMLInputElement>(
      '#program-end-at-undecided',
    );
    if (reopenedToggle === null)
      throw new TypeError('Missing reopened control.');
    await act(async () => reopenedToggle.click());
    await act(async () => button('날짜 적용').click());
    expect(document.body.textContent).toContain(
      '종료일을 정하거나 「종료일 미정」을 선택해 주세요.',
    );
  });

  it('unchanged 적용은 callbacks/dirty 없이 원래 ISO 초·밀리초를 보존한다', async () => {
    await render();
    await openOperation();
    await act(async () => button('날짜 적용').click());

    expect(dirty).toEqual([]);
    expect(buildProgramEditInput(form, dirty)).toMatchObject({
      applicationStartAt: datedProgram.applicationStartAt,
      applicationEndAt: datedProgram.applicationEndAt,
      startAt: datedProgram.startAt,
      endAt: datedProgram.endAt,
    });
  });

  it('basic dialog에서만 calendar로 날짜를 고르고 기존 HH:mm을 유지한다', async () => {
    await render();
    await openOperation();
    const calendar = document.body.querySelector(
      '[aria-label="운영 기간 날짜 선택 달력"]',
    );
    expect(calendar).not.toBeNull();
    expect(
      document.body.querySelector('input[aria-label="운영 기간 시작일"]'),
    ).not.toBeNull();
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[data-calendar-date="2026-08-17"]')
        ?.click();
      document.body
        .querySelector<HTMLButtonElement>('[data-calendar-date="2026-08-31"]')
        ?.click();
    });
    expect(
      document.body.querySelector<HTMLInputElement>(
        'input[aria-label="운영 기간 시작 시각"]',
      )?.value,
    ).toBe('18:30');
    expect(
      document.body.querySelector<HTMLInputElement>(
        'input[aria-label="운영 기간 종료 시각"]',
      )?.value,
    ).toBe('18:30');
  });

  it('부모 저장 중에는 새 일정 dialog를 열지 않는다', async () => {
    await render(datedProgram, true);

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="신청 기간 수정"]',
    );
    expect(trigger?.disabled).toBe(true);
    await act(async () => trigger?.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('수정 아이콘은 focus tooltip과 44px 행동 영역을 제공한다', async () => {
    await render();
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="신청 기간 수정"]',
    );
    if (trigger === null) throw new TypeError('Missing application trigger.');
    expect(trigger.className).toContain('size-11');

    vi.useFakeTimers();
    await act(async () => {
      trigger.focus();
      vi.advanceTimersByTime(200);
    });
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(
      '신청 기간 수정',
    );
    vi.useRealTimers();
  });
});
