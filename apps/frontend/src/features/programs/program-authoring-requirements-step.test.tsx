// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completedAuthoringState } from './program-creation-test-fixtures';
import { ProgramAuthoringRequirementsStep } from './program-authoring-requirements-step';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('ProgramAuthoringRequirementsStep', () => {
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

  it('names each milestone requirements card for scoped controls', async () => {
    // Given
    const completed = completedAuthoringState();
    const information = completed.milestones[0];
    if (information === undefined) throw new TypeError('Missing milestone.');
    const state = {
      ...completed,
      milestones: [
        { ...information, id: 'information', name: '안내용 마일스톤' },
        { ...information, id: 'required', name: '필수 계획서' },
      ],
    };

    // When
    await act(async () => {
      root.render(
        <ProgramAuthoringRequirementsStep
          state={state}
          issues={[]}
          dispatch={vi.fn()}
          newId={() => 'requirement'}
          onFileChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
    });

    // Then
    expect(
      container.querySelectorAll('[aria-label="안내용 마일스톤 요구서류"]'),
    ).toHaveLength(1);
  });
});
