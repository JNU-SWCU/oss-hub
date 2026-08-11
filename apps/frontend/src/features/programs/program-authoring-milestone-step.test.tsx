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
          onRequirementFileChange={vi.fn()}
          onRequirementRemove={vi.fn()}
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
          onRequirementFileChange={vi.fn()}
          onRequirementRemove={vi.fn()}
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

  it('마일스톤마다 요구서류 영역에 이름을 붙여 컨트롤을 구분한다', async () => {
    // Given
    const completed = completedAuthoringState();
    const first = completed.milestones[0];
    if (first === undefined) throw new TypeError('Missing milestone.');
    const state = {
      ...completed,
      milestones: [
        { ...first, id: 'information', name: '안내용 마일스톤' },
        { ...first, id: 'required', name: '필수 계획서' },
      ],
    };

    // When
    await act(async () => {
      root.render(
        <ProgramAuthoringMilestoneStep
          state={state}
          issues={[]}
          dispatch={vi.fn()}
          newId={() => 'requirement'}
          onRemove={vi.fn()}
          onRequirementFileChange={vi.fn()}
          onRequirementRemove={vi.fn()}
        />,
      );
    });

    // Then
    expect(
      container.querySelectorAll('[aria-label="안내용 마일스톤 요구서류"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[aria-label="필수 계획서 요구서류"]'),
    ).toHaveLength(1);
  });

  it('마일스톤 카드에서 요구서류 항목을 그 자리에서 추가·삭제한다', async () => {
    // Given
    const state = completedAuthoringState();
    expect(state.milestones[0]?.requirements).toHaveLength(0);
    const dispatch = vi.fn();
    const onRequirementRemove = vi.fn();

    // When
    await act(async () => {
      root.render(
        <ProgramAuthoringMilestoneStep
          state={state}
          issues={[]}
          dispatch={dispatch}
          newId={() => 'requirement-new'}
          onRemove={vi.fn()}
          onRequirementFileChange={vi.fn()}
          onRequirementRemove={onRequirementRemove}
        />,
      );
    });
    const addButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '항목 추가',
    );
    await act(async () => {
      addButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    // Then
    expect(dispatch).toHaveBeenCalledWith({
      type: 'add_requirement',
      milestoneId: 'milestone-1',
      requirementId: 'requirement-new',
    });

    // Given a state that already has one requirement
    const withRequirement = {
      ...state,
      milestones: [
        {
          ...state.milestones[0]!,
          requirements: [
            {
              id: 'requirement-1',
              name: '결과 보고서',
              required: true,
              submissionType: 'FILE' as const,
              templateFile: null,
            },
          ],
        },
      ],
    };
    await act(async () => {
      root.render(
        <ProgramAuthoringMilestoneStep
          state={withRequirement}
          issues={[]}
          dispatch={dispatch}
          newId={() => 'requirement-new'}
          onRemove={vi.fn()}
          onRequirementFileChange={vi.fn()}
          onRequirementRemove={onRequirementRemove}
        />,
      );
    });
    const removeButtons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent === '삭제',
    );
    // 두 번째 삭제 버튼이 요구서류 항목의 삭제 버튼이다 (첫 번째는 마일스톤 자체 삭제).
    await act(async () => {
      removeButtons[1]?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    // Then
    expect(onRequirementRemove).toHaveBeenCalledOnce();
    expect(onRequirementRemove).toHaveBeenCalledWith(
      'milestone-1',
      'requirement-1',
    );
  });
});
