import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProgramAuthoringOperationsStep } from './program-authoring-final-steps';
import { buildProgramAuthoringManifest } from './program-authoring-manifest';
import {
  createInitialProgramAuthoringState,
  programAuthoringReducer,
  type ProgramAuthoringState,
} from './program-authoring-model';
import { completedAuthoringState } from './program-creation-test-fixtures';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function OperationsStepHarness({
  initial,
  onState,
}: {
  readonly initial: ProgramAuthoringState;
  readonly onState: (state: ProgramAuthoringState) => void;
}) {
  const [state, dispatch] = useReducer(programAuthoringReducer, initial);
  onState(state);
  return <ProgramAuthoringOperationsStep state={state} dispatch={dispatch} />;
}

describe('ProgramAuthoringOperationsStep — 마감 알림 스위치', () => {
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
      '#authoring-deadline-notification',
    );
    if (input === null) throw new TypeError('Missing deadline checkbox.');
    return input;
  }

  async function render(initial: ProgramAuthoringState): Promise<{
    latest: () => ProgramAuthoringState;
  }> {
    let latest = initial;
    await act(async () => {
      root.render(
        <OperationsStepHarness
          initial={initial}
          onState={(state) => {
            latest = state;
          }}
        />,
      );
    });
    return { latest: () => latest };
  }

  it('새 프로그램은 마감 알림이 켜진 채로 열리고 무엇을 켜는지 설명한다', async () => {
    await render(
      createInitialProgramAuthoringState({
        idempotencyKey: 'request-1',
        milestoneId: 'milestone-1',
      }),
    );

    expect(deadlineCheckbox().checked).toBe(true);
    expect(container.textContent).toContain('제출 마감 알림');
    expect(container.textContent).toContain(
      '켜면 마감까지 24시간 이내인 필수 서류의 미제출 참여자에게 알림을 보냅니다.',
    );
  });

  it('체크를 풀면 그 선택이 서버로 보낼 manifest 까지 내려간다', async () => {
    const { latest } = await render(completedAuthoringState());
    expect(deadlineCheckbox().checked).toBe(true);

    await act(async () => {
      deadlineCheckbox().click();
    });

    expect(deadlineCheckbox().checked).toBe(false);
    expect(latest().notifyOnDeadline).toBe(false);
    expect(
      buildProgramAuthoringManifest(latest(), new Map()).notifyOnDeadline,
    ).toBe(false);
  });

  it('다시 체크하면 manifest 도 다시 켜진다', async () => {
    const { latest } = await render({
      ...completedAuthoringState(),
      notifyOnDeadline: false,
    });
    expect(deadlineCheckbox().checked).toBe(false);

    await act(async () => {
      deadlineCheckbox().click();
    });

    expect(latest().notifyOnDeadline).toBe(true);
    expect(
      buildProgramAuthoringManifest(latest(), new Map()).notifyOnDeadline,
    ).toBe(true);
  });
});
