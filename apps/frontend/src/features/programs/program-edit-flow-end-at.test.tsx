

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditableProgram } from './api';
import {
  buildProgramEditInput,
  mapProgramEditError,
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
      onCoverChange={() => undefined}
      program={program}
      form={form}
      errors={{}}
      toastMessage={null}
      generalAlert={null}
      isSaving={isSaving}
      milestoneEditor={{ mode: 'closed' }}
      deleteTarget={null}
      isMilestoneBusy={false}
      canDeleteProgram={false}
      onProgramDeleted={noOp}
      onFieldChange={(field, value) => {
        setForm((current) => updateProgramForm(current, field, value));
        setDirty((current) => addDirtyField(current, field));
      }}
      onSubmit={vi.fn()}
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

describe('프로그램 편집 일정 dialog — 종료일은 실제 날짜만 받는다', () => {
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

  function calendarDate(date: string): HTMLButtonElement {
    const value = document.body.querySelector<HTMLButtonElement>(
      `[data-calendar-date="${date}"]`,
    );
    if (value === null) throw new TypeError(`Missing calendar date ${date}.`);
    return value;
  }

  // #1420: 만들기 폼처럼 편집에서도 종료일을 「미정」으로 되돌릴 길이 없다.
  it('운영 기간 dialog에 「종료일 미정」 선택지가 없고 종료 입력은 늘 열려 있다', async () => {
    await render();
    await openOperation();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog === null) throw new TypeError('Missing dialog.');

    expect(document.body.querySelector('#program-end-at-undecided')).toBeNull();
    expect(dialog.querySelector('input[type="checkbox"]')).toBeNull();
    expect(dialog.textContent).not.toContain('미정');
    expect(
      dialog.querySelector<HTMLInputElement>(
        'input[aria-label="운영 기간 종료일"]',
      )?.disabled,
    ).toBe(false);
    expect(
      dialog.querySelector<HTMLInputElement>(
        'input[aria-label="운영 기간 종료 시각"]',
      )?.disabled,
    ).toBe(false);
  });

  it('Escape는 local 변경을 버리고 같은 수정 버튼으로 초점을 돌린다', async () => {
    await render();
    await openOperation();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog === null) throw new TypeError('Missing dialog.');
    await act(async () => calendarDate('2026-08-17').click());
    expect(
      dialog.querySelector<HTMLInputElement>(
        'input[aria-label="운영 기간 종료일"]',
      )?.value,
    ).toBe('2026-08-17');
    await act(async () =>
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );

    expect(form.startAt).toBe('2026-08-16T18:30');
    expect(form.endAt).toBe('2026-08-31T18:30');
    expect(dirty).toEqual([]);
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="운영 기간 수정"]'),
    );
  });

  it('「미정」 센티널로 저장된 옛 프로그램은 빈 종료일로 열리고, 실제 날짜를 넣어야 적용·저장된다', async () => {
    await render({ ...datedProgram, endAt: PROGRAM_END_AT_UNDECIDED });

    // 요약에도 「미정」이 아니라 비어 있는 종료일이 보인다.
    const summary = container.querySelector(
      '[data-schedule-summary="operation"]',
    );
    expect(summary?.textContent).toContain('→ 날짜를 선택해 주세요.');
    expect(summary?.textContent).not.toContain('미정');
    let blocked: unknown;
    try {
      buildProgramEditInput(form, dirty);
    } catch (error) {
      blocked = error;
    }
    expect(mapProgramEditError(blocked).endAt).toBe(
      '운영 종료를 입력해 주세요.',
    );

    await openOperation();
    const endDate = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="운영 기간 종료일"]',
    );
    expect(endDate?.value).toBe('');
    await act(async () => button('날짜 적용').click());
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('운영 종료를 입력해 주세요.');
    expect(dirty).toEqual([]);

    await act(async () => calendarDate('2026-08-17').click());
    await act(async () => calendarDate('2026-08-31').click());
    await act(async () => button('날짜 적용').click());

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(buildProgramEditInput(form, dirty).endAt).toBe(
      '2026-08-31T14:59:00.000Z',
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
    expect(trigger.dataset.size).toBe('icon');

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
