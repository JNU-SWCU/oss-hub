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
import { addDirtyField, updateProgramForm } from './program-edit-state';
import { ProgramEditView } from './program-edit-view';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const noOp = () => undefined;

const editableProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: 'SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'oss-contest',
  lifecycle: 'PUBLISHED',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  applicationStartAt: '2026-08-01T09:30:59.000Z',
  applicationEndAt: '2026-08-15T09:30:59.000Z',
  startAt: '2026-08-16T09:30:59.000Z',
  endAt: '2026-08-31T09:30:59.000Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: false,
  description: '프로그램 설명',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [],
};

function EditViewHarness({
  program,
  onForm,
}: {
  readonly program: EditableProgram;
  readonly onForm: (
    form: ProgramEditForm,
    dirtyFields: readonly ProgramEditableField[],
  ) => void;
}) {
  const [form, setForm] = useState(() => toProgramEditForm(program));
  const [dirtyFields, setDirtyFields] = useState<
    readonly ProgramEditableField[]
  >([]);
  onForm(form, dirtyFields);
  return (
    <ProgramEditView
      onCoverChange={() => undefined}
      program={program}
      form={form}
      errors={{}}
      toastMessage={null}
      generalAlert={null}
      isSaving={false}
      milestoneEditor={{ mode: 'closed' }}
      deleteTarget={null}
      isMilestoneBusy={false}
      canDeleteProgram={false}
      onProgramDeleted={noOp}
      onFieldChange={(field, value) => {
        setForm((current) => updateProgramForm(current, field, value));
        setDirtyFields((current) => addDirtyField(current, field));
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

describe('프로그램 편집 화면 — 마감 알림 스위치 왕복', () => {
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

  function deadlineCheckbox(): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>(
      '#program-deadline-notification',
    );
    if (input === null) throw new TypeError('Missing deadline checkbox.');
    return input;
  }

  async function render(program: EditableProgram): Promise<{
    payload: () => ReturnType<typeof buildProgramEditInput>;
  }> {
    let latest = toProgramEditForm(program);
    let latestDirty: readonly ProgramEditableField[] = [];
    await act(async () => {
      root.render(
        <EditViewHarness
          program={program}
          onForm={(form, dirtyFields) => {
            latest = form;
            latestDirty = dirtyFields;
          }}
        />,
      );
    });
    return {
      payload: () => buildProgramEditInput(latest, latestDirty),
    };
  }

  it('꺼져 있던 기존 프로그램을 편집에서 켜면 저장 payload 가 켜진 채로 나간다', async () => {
    const { payload } = await render(editableProgram);
    expect(deadlineCheckbox().checked).toBe(false);
    expect(payload().notifyOnDeadline).toBe(false);

    await act(async () => {
      deadlineCheckbox().click();
    });

    expect(deadlineCheckbox().checked).toBe(true);
    expect(payload().notifyOnDeadline).toBe(true);
  });

  it('켜져 있던 프로그램을 편집에서 끄면 저장 payload 도 꺼진다', async () => {
    const { payload } = await render({
      ...editableProgram,
      notifyOnDeadline: true,
    });
    expect(deadlineCheckbox().checked).toBe(true);

    await act(async () => {
      deadlineCheckbox().click();
    });

    expect(deadlineCheckbox().checked).toBe(false);
    expect(payload().notifyOnDeadline).toBe(false);
  });

  it('저장 전에는 발송 대상 미리보기를 열지 않는다고 화면이 알려 준다', async () => {
    await render(editableProgram);

    await act(async () => {
      deadlineCheckbox().click();
    });

    expect(container.textContent).toContain(
      '설정을 저장한 뒤 발송 대상을 미리볼 수 있습니다.',
    );
  });
});
