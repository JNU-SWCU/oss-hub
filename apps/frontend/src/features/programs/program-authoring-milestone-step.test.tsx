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

  it('마일스톤 이름·날짜·삭제는 일정 단계에 두고 이 단계에서 중복하지 않는다', async () => {
    const state = completedAuthoringState();
    expect(state.milestones).toHaveLength(1);

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

    expect(container.textContent).toContain('날짜를 바꾸려면');
    expect(container.textContent).toContain('신청/운영 일정');
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(container.textContent).not.toContain('제출 방식');
    expect(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === '삭제' && !button.disabled,
      ),
    ).toBe(false);
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
      container.querySelectorAll('[aria-label="안내용 마일스톤 제출 항목"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[aria-label="필수 계획서 제출 항목"]'),
    ).toHaveLength(1);
  });

  it('마일스톤 카드에서 요구서류 항목을 그 자리에서 추가·삭제한다', async () => {
    // Given
    const state = completedAuthoringState();
    expect(state.milestones[0]?.requirements).toHaveLength(1);
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
    const addButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('제출 항목 추가'),
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

    // Given a state that already has two requirements
    const existingRequirement = state.milestones[0]?.requirements[0];
    if (existingRequirement === undefined) {
      throw new TypeError('Missing default submission item.');
    }
    const withRequirement = {
      ...state,
      milestones: [
        {
          ...state.milestones[0]!,
          requirements: [
            existingRequirement,
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
