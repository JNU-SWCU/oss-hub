// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completedAuthoringState } from './program-creation-test-fixtures';
import { ProgramAuthoringMilestoneStep } from './program-authoring-milestone-step';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('ProgramAuthoringMilestoneStep', () => {
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

  it('마일스톤이 1개뿐이면 삭제 버튼을 막는다', async () => {
    // Given
    const state = completedAuthoringState();
    expect(state.milestones).toHaveLength(1);

    // When
    await act(async () => {
      root.render(
        <ProgramAuthoringMilestoneStep
          state={state}
          issues={[]}
          dispatch={vi.fn()}
          newId={() => 'milestone-new'}
          onRemove={vi.fn()}
        />,
      );
    });

    // Then
    const buttons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent === '삭제',
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.disabled).toBe(true);
  });

  it('마일스톤이 2개 이상이면 삭제 버튼을 쓸 수 있고 해당 id로 제거를 요청한다', async () => {
    // Given
    const completed = completedAuthoringState();
    const first = completed.milestones[0];
    if (first === undefined) throw new TypeError('Missing milestone.');
    const state = {
      ...completed,
      milestones: [
        { ...first, id: 'milestone-a', name: '오리엔테이션' },
        { ...first, id: 'milestone-b', name: '중간 발표' },
      ],
    };
    const onRemove = vi.fn();

    // When
    await act(async () => {
      root.render(
        <ProgramAuthoringMilestoneStep
          state={state}
          issues={[]}
          dispatch={vi.fn()}
          newId={() => 'milestone-new'}
          onRemove={onRemove}
        />,
      );
    });
    const buttons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent === '삭제',
    );
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.disabled).toBe(false);
    await act(async () => {
      buttons[1]?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    // Then
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith('milestone-b');
  });
});
