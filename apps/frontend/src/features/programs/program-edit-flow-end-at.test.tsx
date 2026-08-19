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

/** React 가 제어하는 입력란에 값을 넣는다 — 저장소의 다른 화면 테스트와 같은 방식이다. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 종료일이 정해진 보통 프로그램. */
const datedProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: 'SW중심대학사업단',
  category: 'OSS_CONTEST',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  categoryLocked: {
    locked: false,
    byApplications: false,
    byTeams: false,
    applicationCount: 0,
    teamCount: 0,
  },
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

/**
 * 종료일을 안 정하고 만든(또는 레거시 `NULL` 이었던) 프로그램 — 서버가 센티널을
 * 들고 있다. #826 이 이 상태에서 터졌다.
 */
const undecidedProgram: EditableProgram = {
  ...datedProgram,
  endAt: PROGRAM_END_AT_UNDECIDED,
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
      program={program}
      form={form}
      errors={{}}
      toastMessage={null}
      generalAlert={null}
      isSaving={false}
      milestoneEditor={{ mode: 'closed' }}
      deleteTarget={null}
      expandedDocumentsMilestoneId={null}
      isMilestoneBusy={false}
      isDirty={dirtyFields.length > 0}
      isLifecycleBusy={false}
      isLifecycleConfirming={false}
      lifecycleError={null}
      isAdmin={false}
      onFieldChange={(field, value) => {
        setForm((current) => updateProgramForm(current, field, value));
        setDirtyFields((current) => addDirtyField(current, field));
      }}
      onSubmit={vi.fn()}
      onReset={noOp}
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

describe('프로그램 편집 화면 — 종료일 미정 (#826)', () => {
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

  function required<T extends Element>(selector: string): T {
    const element = container.querySelector<T>(selector);
    if (element === null) throw new TypeError(`Missing ${selector}.`);
    return element;
  }

  const dateInput = () => required<HTMLInputElement>('#program-end-at');
  const undecidedBox = () =>
    required<HTMLInputElement>('#program-end-at-undecided');

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
    return { payload: () => buildProgramEditInput(latest, latestDirty) };
  }

  it('센티널을 든 프로그램은 「종료일 미정」이 켜진 채 열리고 날짜 칸이 비활성이다', async () => {
    // Given / When
    await render(undecidedProgram);

    // Then
    expect(undecidedBox().checked).toBe(true);
    expect(dateInput().disabled).toBe(true);
    expect(dateInput().value).toBe('');
    expect(container.textContent).toContain('종료일 미정');
  });

  // #826 의 회귀 가드 — 센티널을 KST 로 옮기면 연도가 다섯 자리가 되고 그 값은
  // 되돌릴 수 없다. 어떤 형태로든 화면에 나오면 안 된다.
  it('다섯 자리 연도가 화면에 새 나오지 않는다', async () => {
    await render(undecidedProgram);

    expect(container.innerHTML).not.toContain('10000');
    expect(container.innerHTML).not.toContain('9999');
  });

  it('미정인 채로 저장하면 센티널이 그대로 왕복한다', async () => {
    // Given
    const { payload } = await render(undecidedProgram);

    // When / Then: 아무것도 건드리지 않아도 저장이 성공하는 값이 나간다.
    expect(payload().endAt).toBe(PROGRAM_END_AT_UNDECIDED);
  });

  it('체크를 풀면 날짜를 고를 수 있고 고른 날짜가 저장 payload 로 나간다', async () => {
    // Given
    const { payload } = await render(undecidedProgram);

    // When: 체크를 풀고 날짜를 고른다.
    await act(async () => {
      undecidedBox().click();
    });
    expect(dateInput().disabled).toBe(false);

    await type(dateInput(), '2026-09-01T19:45');

    // Then
    expect(payload().endAt).toBe(new Date(2026, 8, 1, 19, 45).toISOString());
  });

  it('날짜가 있던 프로그램에서 미정을 켜면 날짜 칸이 비고 센티널이 나간다', async () => {
    // Given
    const { payload } = await render(datedProgram);
    expect(undecidedBox().checked).toBe(false);
    expect(dateInput().disabled).toBe(false);
    expect(dateInput().value).not.toBe('');

    // When
    await act(async () => {
      undecidedBox().click();
    });

    // Then
    expect(dateInput().disabled).toBe(true);
    expect(dateInput().value).toBe('');
    expect(payload().endAt).toBe(PROGRAM_END_AT_UNDECIDED);
  });

  it('미정을 켰다 풀면 날짜 칸이 비어 있어 다시 골라야 한다', async () => {
    // Given
    const { payload } = await render(datedProgram);

    // When: 켜고 다시 푼다.
    await act(async () => {
      undecidedBox().click();
    });
    await act(async () => {
      undecidedBox().click();
    });

    // Then: 비어 있는 것은 「미정」이 아니라 아직 안 고른 상태다 — 저장이 막힌다.
    expect(dateInput().disabled).toBe(false);
    expect(dateInput().value).toBe('');
    expect(() => payload()).toThrow();
  });
});
